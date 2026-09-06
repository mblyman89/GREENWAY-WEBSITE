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

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  parseAamvaPdf417,
  evaluateScannedId,
  evaluateManualId,
  ACCEPTABLE_ID_TYPES,
  OVER40_VISUAL_MIN_AGE,
  OVER40_VISUAL_REASON,
  maskDateDigitsMdy,
  mdyToYmd,
  type IdGateVerdict,
} from "@/lib/pos/id-scan-core";
import {
  addToCart,
  setCartQuantity,
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
import { emptyWedgeState, wedgeKey, type WedgeState } from "@/lib/pos/wedge-scan-core";
import { useSocketScanner } from "@/lib/pos/use-socket-scanner";
import {
  emptyIdCaptureState,
  feedIdCaptureKey,
  finalizeIdCapture,
  ID_CAPTURE_FALLBACK_IDLE_MS,
  shouldDrainKey,
  type IdCaptureState,
} from "@/lib/pos/id-capture-core";
import {
  applyLoyaltyToPricedLines,
  maxRedeemablePoints,
  normalizeLoyaltyCodeInput,
  pricingFingerprint,
  type AppliedLoyalty,
  type PosLoyaltyGrant,
  type PosLoyaltyRequest,
} from "@/lib/pos/register-loyalty-core";
// SLICE 28 — special discounts (employee/industry/veteran) at the register:
// pure percent math + floors + the people-rules, plus the display formatter.
import {
  applySpecialDiscountToLines,
  applySpecialDiscountToPricedLines,
  availableSpecialDiscounts,
  checkSpecialDiscountAtRegister,
  type AppliedSpecialDiscount,
} from "@/lib/pos/special-discount-sale-core";
import { formatBps, type SpecialDiscountKind } from "@/lib/discounts/special-discount-core";
import { categoryColorIndex, filterMenuProducts, menuCategoryChips, CATEGORY_COLOR_COUNT } from "@/lib/pos/sale-grid-core";
// SLICE 18D — register visibility for the two specially-limited buckets. The
// labels live in the POS core (not the storefront) because this screen must not
// depend on the storefront menu modules; both sides stay in step by deriving
// from sales-limits-core, never by importing each other.
import {
  posClassificationChips,
  productClassifications,
  POS_CLASSIFICATION_LABELS,
  POS_CLASSIFICATION_TITLES,
  type PosClassificationKind,
} from "@/lib/pos/classification-search-core";
import {
  FAVORITES_KEY,
  MAX_FAVORITES,
  favoriteProducts,
  parseFavorites,
  serializeFavorites,
  toggleFavorite,
} from "@/lib/pos/favorites-core";
// Phase 1.1 — favorites go through the storage seam like every other register
// value, so the packaged iPad app persists them durably with no call-site change.
import { posStorageGet, posStorageSet } from "@/lib/pos/pos-storage";
import { manualAddBlocked } from "@/lib/pos/scan-required-core";
import { buildProductInfo } from "@/lib/pos/product-info-core";
import { STOCK_FLAG_REASONS, canFlagOutOfStock, type StockFlagReason } from "@/lib/pos/stock-flag-core";
import {
  buildCustomProduct,
  keypadAppend,
  keypadBackspace,
  keypadClear,
  CUSTOM_SALE_CATEGORIES,
  MAX_CUSTOM_NOTE_LENGTH,
  type CustomSaleCategory,
} from "@/lib/pos/custom-sale-core";
import {
  applyPriceOverrides,
  overrideFloorMinor,
  validateOverrideRequest,
  type PosLineOverride,
} from "@/lib/pos/price-override-core";
import { dollarsToMinor } from "@/lib/pos/till-core";
import {
  changeBreakdown,
  smartTenderSuggestions,
  tenderKeypadAppend,
  tenderKeypadBackspace,
} from "@/lib/pos/change-calc-core";
import { roundCashDue, normalizePosCashRoundingConfig } from "@/lib/pos/cash-rounding-core";
import { stockSignal, cartStockWarnings } from "@/lib/pos/low-stock-core";
import {
  canAddOne,
  isKnownOutOfStock,
  stockBlockingLines,
  stockRefusalMessage,
} from "@/lib/pos/stock-ceiling-core";
// SLICE 15 — post-override behaviour, built from researched industry practice
// (docs/slice-15-research-oversold-industry-standard.md): warn before, never
// block completion, keep the receipt clean, record the variance with full
// attribution, and issue a count command at the moment of discovery.
import { countPromptMessage, oversoldVariances } from "@/lib/pos/oversold-variance-core";
// Saved-cart smart release — notice when the SAVED sale is sitting on units
// this live cart needs, and offer to release it right at the conflict moment.
import { heldStockConflicts, describeHeldLines } from "@/lib/pos/held-stock-core";
import { ageLabel, type HeldSale } from "@/lib/pos/register-polish-core";
import {
  validateCardCapture,
  medicalAgeAllowed,
  applyMedicalPricing,
  medicalCardBadge,
  type PosCardCapture,
  type MedicalPricingResult,
} from "@/lib/pos/medical-pos-core";
import { computeOrderTotals, type OrderTotals } from "@/lib/orders/order-pricing-core";
import { evaluateSalesHours } from "@/lib/compliance/sales-hours-core";
import { pacificDayKey } from "@/lib/reports/timezone";
import { SAW_LOGIN_URL, sanitizeSawUsername } from "@/lib/pos/saw-prefill-core";
import {
  buildPosReceiptHtml,
  type PosReceiptInput,
} from "@/lib/pos/receipt-core";
import { getPairedPrinterIdentifier, printReceipt } from "@/lib/pos/star-printer";
import {
  normalizePosReceiptConfig,
  receiptAddressLines,
} from "@/lib/pos/receipt-config-core";
import type { MemberHistory } from "@/lib/pos/member-history-core";

type Step = "idgate" | "cart" | "tender" | "done";

/**
 * B36 — the category chip/tile palette. Index = categoryColorIndex(category),
 * so "flower" paints identically on every register with zero config. MUST
 * hold exactly CATEGORY_COLOR_COUNT entries — the guard below throws at
 * module load (and therefore in every test run) if the two drift apart.
 * Each entry: chip = filter-chip accents, dot = the tile's category dot.
 */
const CATEGORY_TILE_STYLES: { chip: string; dot: string }[] = [
  { chip: "border-[var(--pos-ok-border)] text-[var(--pos-ok)]", dot: "bg-[var(--pos-ok)]" },
  { chip: "border-[var(--pos-info-border)] text-[var(--pos-info)]", dot: "bg-[var(--pos-info)]" },
  { chip: "border-[var(--pos-warn-border)] text-[var(--pos-warn)]", dot: "bg-[var(--pos-warn-dot)]" },
  // AO-5 — the last five entries were hard-coded Tailwind -300/-400 shades
  // (dark-canvas only, illegible on the light default). Now tokens: the
  // html[data-pos-theme] blocks in globals.css re-tint each per theme.
  { chip: "border-[var(--pos-cat-fuchsia-border)] text-[var(--pos-cat-fuchsia)]", dot: "bg-[var(--pos-cat-fuchsia-dot)]" },
  { chip: "border-[var(--pos-cat-rose-border)] text-[var(--pos-cat-rose)]", dot: "bg-[var(--pos-cat-rose-dot)]" },
  { chip: "border-[var(--pos-cat-teal-border)] text-[var(--pos-cat-teal)]", dot: "bg-[var(--pos-cat-teal-dot)]" },
  { chip: "border-[var(--pos-cat-indigo-border)] text-[var(--pos-cat-indigo)]", dot: "bg-[var(--pos-cat-indigo-dot)]" },
  { chip: "border-[var(--pos-cat-orange-border)] text-[var(--pos-cat-orange)]", dot: "bg-[var(--pos-cat-orange-dot)]" },
];
if (CATEGORY_TILE_STYLES.length !== CATEGORY_COLOR_COUNT) {
  throw new Error("CATEGORY_TILE_STYLES must match CATEGORY_COLOR_COUNT (sale-grid-core)");
}

/** B36 — the palette entry for a category (deterministic, shared hash). */
function categoryStyle(category: string): { chip: string; dot: string } {
  return CATEGORY_TILE_STYLES[categoryColorIndex(category)] ?? CATEGORY_TILE_STYLES[0];
}

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
   * Slice 6 — the signed-in employee's SecureAccess Washington (SAW) username
   * ONLY (never a password). Shown at the medical card-verification step so the
   * budtender knows exactly which SAW login to use before opening the DOH
   * registry. Null when not set on their employee file.
   */
  employeeSawUsername?: string | null;
  /**
   * B17 — resume a held sale: cart lines rebuilt by the SHELL against the
   * CURRENT bundle (fresh prices; vanished/out-of-stock lines already
   * dropped). The ID gate still runs first — a held cart never inherits the
   * previous customer's age verification.
   */
  initialCart?: PosCartEntry[];
  /**
   * AM-D — pre-attach this loyalty member when a WEBSITE ORDER was loaded
   * into the sale (the order's linked customer, shaped like a /api/pos/member
   * hit by the load endpoint). The ID gate still runs first — an attached
   * member never skips age verification.
   */
  initialMember?: PosMemberHit;
  /**
   * B17 — park this cart and exit the sale ("customer forgot their wallet").
   * The shell persists a MINIMAL snapshot (variant ids + counts). Omitted
   * when a hold already exists — one parked sale at a time keeps the drawer
   * story simple.
   */
  onHold?: (cart: PosCartEntry[]) => void;
  /**
   * Saved-cart smart release — the device's CURRENT parked hold, so the live
   * sale can notice when the saved cart is sitting on units this cart needs
   * (the menu's count can't cover both). Pass null/undefined when no hold
   * exists OR when THIS sale is the resumed hold — it must never conflict
   * with itself. Advisory only; never blocks.
   */
  heldSale?: HeldSale | null;
  /**
   * Saved-cart smart release — delete the parked hold from the register (the
   * same action as the home screen's Discard button), offered right at the
   * conflict moment so the cashier can free the unit without hunting for the
   * saved sale. Omitted when there is nothing to release.
   */
  onReleaseHold?: () => void;
  /**
   * SESSION RESUME — when the idle auto-lock parks an in-progress sale that is
   * already PAST the age gate, the shell re-mounts SaleFlow with the parked
   * verdict so the budtender does NOT rescan the customer's ID. RE-VALIDATED
   * by the shell (active-sale-resume-core) before it is passed in: age still
   * >= 21, ID not expired, within TTL. When present, the flow starts at the
   * cart step with this verdict already in hand.
   */
  initialVerdict?: Extract<IdGateVerdict, { allowed: true }>;
  /**
   * SESSION RESUME — the parked medical recognition card (if the resumed sale
   * was medical), so the sale stays medical (pricing + 3x limits) without
   * re-capturing the card. Re-validated (card not expired) by the shell.
   */
  initialMedicalCard?: PosCardCapture;
  /**
   * Present when this sale was started from a website pickup order loaded into
   * the register: the source order's UUID. It is forwarded into the completed
   * sale's payload so the sync supersedes the website order ONLY on completion
   * (never on load). Omitted for walk-in sales.
   */
  initialSourceOrderId?: string;
  /**
   * SESSION RESUME — report the CURRENT resumable sale state up to the shell
   * (verdict + cart lines + medical card + member) whenever it changes, so the
   * shell can persist a snapshot the instant an idle auto-lock fires. Called
   * with null when the sale is not resumable (pre-gate or empty cart) so the
   * shell can clear any stale snapshot.
   */
  onSnapshot?: (
    state: {
      verdict: Extract<IdGateVerdict, { allowed: true }> | null;
      cart: PosCartEntry[];
      medicalCard: PosCardCapture | null;
      member: PosMemberHit | null;
      // SLICE 14 — null means "there is nothing resumable here; clear any
      // stored snapshot". The doc comment above always promised this, but the
      // type did not permit it, so a COMPLETED sale had no way to say so.
    } | null,
  ) => void;
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
   * AO-3 — auto-attach after a PASSING scan: the parsed name + DOB go to the
   * server-side match endpoint; an unambiguous single match comes back as
   * the same privacy-lean hit the manual lookup returns (or null). Best
   * effort and ONLINE-ONLY — any failure just means no auto-attach, and the
   * budtender can still use the manual lookup. Never overrides a member
   * already on the sale (AM-D order load).
   */
  onMemberMatch?: (identity: { firstName: string | null; lastName: string | null; dateOfBirth: string }) => Promise<PosMemberHit | null>;
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
  /**
   * SLICE 28 — employee-identity PIN check for the EMPLOYEE purchase
   * program. ONLINE-ONLY (a PIN can't be verified offline). The shell posts
   * /api/pos/witness (device auth + scrypt + shared throttle, NO role gate —
   * any active employee counts). Called twice: once so the BUYING employee
   * identifies themselves, once for the WITNESS; the register refuses to
   * proceed when both resolve to the same person.
   */
  onWitness?: (pin: string) => Promise<{ ok: true; employee: { id: string; fullName: string } } | { ok: false; error: string }>;
  /**
   * SLICE 23 — draw ONE fun name from the shared pool for the receipt this
   * sale is about to print.
   *
   * Owner: "as for the fun receipt overlay for printed receipts, I think we
   * should draw from the same pool. we rarely go without internet, and if we
   * do, the fall back can be to just use the real receipt number instead of
   * the overlay."
   *
   * ONLINE-ONLY and NEVER load-bearing. It resolves to null for every failure
   * — offline, empty pool, server error, endpoint absent — and null simply
   * means the receipt prints the real receipt number, which is precisely the
   * fallback the owner described. It must never reject, and the sale must
   * never wait on it.
   */
  onOrderName?: () => Promise<string | null>;
  /**
   * SLICE 28 — the unlocked cashier's employees.id + this device's register
   * id, needed by the employee-program safety rules (the buyer can't be the
   * cashier logged into THIS register). Optional so nothing else breaks;
   * the employee program simply won't offer itself without them.
   */
  employeeId?: string;
  registerId?: string;
  /**
   * B42 — resolve the info card's photo (ONLINE-ONLY; the shell calls
   * /api/pos/product-image with device auth). The ONE image the register
   * ever shows — the grid stays text-first by owner decision. Offline or
   * failed = null image; the card still shows every fact.
   */
  onProductImage?: (productId: string) => Promise<{ url: string; isFallback: boolean } | null>;
  /**
   * B43 — out-of-stock quick-flag (Toast "86 it"). ONLINE-ONLY: the shell
   * posts /api/pos/stock-flag (device auth, audited) and, on success,
   * removes the item from its cached bundle so the tile disappears at once.
   * One-way — bringing an item back is a back-office action.
   */
  onStockFlag?: (productId: string, reason: StockFlagReason) => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Task AM-B — loyalty redemption at the register. ONLINE-ONLY: the shell
   * posts /api/pos/loyalty (device auth), which verifies the balance, issues
   * (or looks up) the code, and computes the per-variant spread with the
   * server's legal floors. "release" cancels a points-issued code and
   * refunds the points when the register drops the discount.
   */
  onLoyalty?: (
    req: PosLoyaltyRequest,
  ) => Promise<{ ok: true; grant: PosLoyaltyGrant } | { ok: false; error: string }>;
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

export function SaleFlow({ bundle, drawerSessionId, registerName, employeeName, employeeSawUsername, initialCart, initialMember, initialVerdict, initialMedicalCard, initialSourceOrderId, onSnapshot, onHold, heldSale, onReleaseHold, onReceiptFrozen, onMemberLookup, onMemberMatch, onMemberHistory, onEmailReceipt, onApprove, onWitness, onOrderName, employeeId, registerId, onProductImage, onStockFlag, onLoyalty, onEnqueue, onComplete, onCancel }: SaleFlowProps) {
  // SESSION RESUME — a re-validated parked verdict starts the flow PAST the
  // age gate (at the cart), so the customer's ID is not rescanned.
  const [step, setStep] = useState<Step>(initialVerdict ? "cart" : "idgate");
  // IDS-5 — post-scan burst DRAIN. Content-driven completion finalizes the
  // scan the instant it is gate-ready, but the wedge scanner keeps streaming
  // the REST of the PDF417 (weight "DAW160", eye color, address\u2026). Once the ID
  // gate hands off to the cart, those trailing keystrokes would land in the
  // product-search box ("can't find DAW160" + a stray search). This ref holds
  // the finalize timestamp; a document-level guard mounted for the WHOLE flow
  // (so it survives the idgate→cart transition) swallows every keystroke while
  // inside the drain window — each trailing key re-arms it, so it ends only
  // once the scanner burst genuinely stops.
  const lastScanFinalizeRef = useRef<number | null>(null);
  const noteScanFinalized = useCallback(() => {
    lastScanFinalizeRef.current = performance.now();
  }, []);
  useEffect(() => {
    const onKeyDownCapture = (e: KeyboardEvent) => {
      const now = performance.now();
      if (!shouldDrainKey(lastScanFinalizeRef.current, now)) return;
      // Still draining the scanner's trailing burst: swallow the key so it
      // never reaches the cart's search box, and re-arm the window.
      lastScanFinalizeRef.current = now;
      e.preventDefault();
      e.stopPropagation();
      // Kill the iOS Safari text-selection ("Select All") popup that the burst
      // triggers by clearing any accidental selection during the drain.
      const sel = typeof window !== "undefined" ? window.getSelection?.() : null;
      if (sel && sel.rangeCount > 0) sel.removeAllRanges();
    };
    // Capture phase so we intercept BEFORE the focused input handles the key.
    document.addEventListener("keydown", onKeyDownCapture, true);
    return () => document.removeEventListener("keydown", onKeyDownCapture, true);
  }, []);
  const [verdict, setVerdict] = useState<Extract<IdGateVerdict, { allowed: true }> | null>(initialVerdict ?? null);
  const [manualEventUuid, setManualEventUuid] = useState<string | null>(null);
  // POS B9 — set ONLY by the ID gate's medical path (card captured + its
  // audit event enqueued). The card, not a toggle, is what makes the sale
  // medical: it drives pricing, the 3× limits, and the payload block.
  const [medicalCard, setMedicalCard] = useState<PosCardCapture | null>(initialMedicalCard ?? null);
  const [cardEventUuid, setCardEventUuid] = useState<string | null>(null);
  // B17 — a resumed hold seeds the cart, but ONLY the cart: the ID gate,
  // medical path, and member attach all start fresh for the returning buyer.
  const [cart, setCart] = useState<PosCartEntry[]>(initialCart ?? []);
  // POS B14 — the loyalty member attached to this sale (server lookup only).
  // AM-D: a loaded website order pre-attaches its linked customer.
  const [member, setMember] = useState<PosMemberHit | null>(initialMember ?? null);
  // SESSION RESUME — push the CURRENT resumable sale state up to the shell so
  // it can persist a snapshot the instant an idle auto-lock fires. A
  // latest-ref keeps the effect from re-subscribing on every parent render;
  // the effect re-runs only when the resumable inputs (verdict, cart, medical
  // card, member) actually change. Pre-gate (no verdict) reports the raw
  // verdict=null and the shell clears any stale snapshot. Prices are NEVER
  // sent — the shell re-prices the cart against the current bundle on resume.
  const onSnapshotRef = useRef(onSnapshot);
  useEffect(() => {
    onSnapshotRef.current = onSnapshot;
  });
  useEffect(() => {
    // SLICE 14 defence 1 of 3 — a COMPLETED sale must stop advertising itself
    // as resumable.
    //
    // The bug the owner hit: finish a sale, walk away without tapping "Done —
    // lock register", and two minutes later the idle timer fires lock() (NOT
    // onComplete). lock() parks whatever this effect last reported, so the
    // finished customer's verdict + cart were written back to storage and the
    // next PIN entry restored them PAST the age gate.
    //
    // Reporting null here makes parkActiveSale clear the snapshot instead of
    // writing one (RegisterShell.parkActiveSale: `live ? snapshot : null`
    // → posStorageRemove). Fixing it at the source means the shell cannot be
    // tricked no matter which lock path runs.
    if (step === "done") {
      onSnapshotRef.current?.(null);
      return;
    }
    onSnapshotRef.current?.({ verdict, cart, medicalCard, member });
  }, [verdict, cart, medicalCard, member, step]);
  // Task AM-B — the loyalty redemption applied to THIS sale (server-issued
  // code + per-variant spread). Dropped automatically the moment the priced
  // cart drifts from the fingerprint it was computed for.
  const [appliedLoyalty, setAppliedLoyalty] = useState<AppliedLoyalty | null>(null);
  // POS B24 — manager-approved price overrides for THIS sale, keyed by
  // variantId. Cleared with the sale; never persisted (a hold resumes at
  // fresh engine prices, and the next customer never inherits a markdown).
  const [overrides, setOverrides] = useState<Record<string, PosLineOverride>>({});
  const [changeMinor, setChangeMinor] = useState<number | null>(null);
  // SLICE 15 — NetSuite's "zero count" pattern: when a pick drives stock past
  // what was tracked, a count command is issued at the moment of discovery,
  // while the person who can resolve it is still in front of the product.
  // Non-blocking by design (Shopify POS and Lightspeed both warn without
  // gating completion) and never printed on the customer's receipt.
  const [countPrompt, setCountPrompt] = useState<string | null>(null);
  // AO-4 — a rail quick-tender button ($130/$140/…/Exact) carries its amount
  // into the tender screen so the drawer opens one tap later. null = the
  // cashier used the plain tender button and starts from $0 as before.
  const [initialTendered, setInitialTendered] = useState<number | null>(null);
  // POS B10 — snapshot of the finished sale for printing/reprint. Captured at
  // the moment the sale is enqueued so the receipt always matches the payload.
  const [receipt, setReceipt] = useState<PosReceiptInput | null>(null);

  // ── SLICE 23 — the fun receipt name, fetched AHEAD of the moment it is
  // needed ────────────────────────────────────────────────────────────────
  //
  // Owner: "for the receipt that prints out, I want it to have the fun overlay
  // on it ... the text bellow the barcode should definitely be the fun
  // overlay."
  //
  // WHY A REF AND A PREFETCH INSTEAD OF AN AWAIT
  //
  // The name has to be in hand at the instant the sale is enqueued, because
  // that is when the receipt snapshot is FROZEN and when the payload is
  // handed to the queue — and that path (onPaid) is synchronous on purpose.
  // Making it async so it could await a name would put a network round-trip
  // between "customer handed over cash" and "drawer opens", and would let a
  // slow or hanging server stall a completed sale. A flourish must never be
  // able to do that.
  //
  // So the name is drawn EARLY (when the tender screen opens — the customer is
  // still counting out cash) and parked in a ref. A ref, not state, because
  // re-rendering the tender screen when a decorative name arrives would be
  // pure noise, and because the enqueue path needs to read the CURRENT value
  // synchronously rather than whatever value was captured in its closure.
  //
  // If it has not arrived by the time the sale completes, the ref still holds
  // null and the receipt prints the real number. That is not a degraded mode
  // to be recovered from — it is the owner's stated fallback.
  const funNameRef = useRef<string | null>(null);
  // Guards against drawing a SECOND name if the cashier steps back to the cart
  // and returns to tender. Every draw consumes a name from the rotation, so an
  // abandoned draw is a name burned for nothing and a repeat pulled closer.
  const funNameRequestedRef = useRef(false);
  const requestFunName = useCallback(() => {
    if (!onOrderName || funNameRequestedRef.current) return;
    funNameRequestedRef.current = true;
    // Fire-and-forget. The .catch is not optional politeness: an unhandled
    // rejection here would surface as a console error over a healthy sale.
    void onOrderName()
      .then((name) => {
        funNameRef.current = typeof name === "string" && name.trim() !== "" ? name.trim() : null;
      })
      .catch(() => {
        funNameRef.current = null;
      });
  }, [onOrderName]);

  // Task AM-B — release a loyalty grant the sale no longer uses: a
  // points-issued code is cancelled server-side (points refunded);
  // a customer-brought code was never claimed, so nothing to do.
  // Fire-and-forget: even if the release call is lost, an unclaimed
  // 'issued' code simply expires (value returns via the expiry sweep).
  const releaseLoyalty = useCallback(
    (applied: AppliedLoyalty | null) => {
      if (applied && applied.source === "points" && onLoyalty) {
        void onLoyalty({ action: "release", redemptionId: applied.redemptionId });
      }
    },
    [onLoyalty],
  );

  // Task AM-B — the spread is only valid for the EXACT priced cart it was
  // computed on. Any drift (item added/removed, quantity changed, override
  // applied, reprice) drops the discount and releases the code — a stale
  // spread must never ship.
  const pricedForLoyalty = priceForBuyer(cart, bundle, !!medicalCard, overrides);
  const loyaltyFingerprint = pricingFingerprint(
    pricedForLoyalty.lines.map((l) => ({
      variantId: l.variantId,
      productId: l.productId,
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
    })),
  );
  useEffect(() => {
    if (appliedLoyalty && appliedLoyalty.fingerprint !== loyaltyFingerprint) {
      releaseLoyalty(appliedLoyalty);
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setAppliedLoyalty(null);
    }
  }, [appliedLoyalty, loyaltyFingerprint, releaseLoyalty]);
  // SLICE 28 — the special discount (employee/industry/veteran) applied to
  // THIS sale. Same drift discipline as loyalty: the per-line reductions are
  // only valid for the EXACT priced cart they were computed on — any change
  // drops the discount and the budtender re-applies. Nothing to release
  // server-side (the ledger row is only written at sync, on completion).
  const [appliedSpecial, setAppliedSpecial] = useState<AppliedSpecialDiscount | null>(null);
  useEffect(() => {
    if (appliedSpecial && appliedSpecial.fingerprint !== loyaltyFingerprint) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setAppliedSpecial(null);
    }
  }, [appliedSpecial, loyaltyFingerprint]);

  // Sales hours (WAC 314-55-147) checked on-device with the owner's window;
  // the server completion gate re-checks with ITS clock at sync time.
  // AQ — the block screen used to be one bare red sentence, so at 12:22 AM it
  // looked like the whole sale flow had been gutted. It now says plainly that
  // the register is fine, and a minute tick re-checks the clock so the screen
  // flips to the ID gate BY ITSELF when the window opens (before, it sat
  // stuck until something else happened to re-render).
  const [, setHoursTick] = useState(0);
  const hours = evaluateSalesHours(new Date(), bundle.hours);
  const hoursBlocked = !hours.allowed && step !== "done";
  useEffect(() => {
    if (!hoursBlocked) return;
    const t = setInterval(() => setHoursTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, [hoursBlocked]);
  if (hoursBlocked) {
    return (
      <Frame title="Sales hours" onCancel={onCancel}>
        <div className="w-full max-w-lg rounded-2xl border-2 border-dashed border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] p-8 text-center">
          <span className="text-5xl" aria-hidden>
            {"\u{1F319}"}
          </span>
          <p className="mt-3 text-2xl font-extrabold tracking-tight">Sales are closed right now</p>
          <p className="mt-4 rounded-lg border border-[var(--pos-danger-border)] bg-[var(--pos-danger-soft)] px-4 py-3 text-sm text-[var(--pos-danger)]">
            {hours.reason}
          </p>
          <p className="mt-4 text-sm text-[var(--pos-text-muted)]">
            Nothing is wrong with the register. The ID check, the house-policy banner and the whole
            sale flow are right behind this clock — this screen re-checks the time every few seconds
            and opens the ID check by itself the moment sales hours begin.
          </p>
        </div>
      </Frame>
    );
  }

  if (step === "idgate") {
    return (
      <IdGateScreen
        medicalAvailable={!!bundle.medical}
        employeeSawUsername={employeeSawUsername ?? null}
        onCancel={onCancel}
        onPassed={(v, manualUuid, card, cardUuid, scannedName) => {
          setVerdict(v);
          setManualEventUuid(manualUuid);
          setMedicalCard(card);
          setCardEventUuid(cardUuid);
          setStep("cart");
          // AO-3 — best-effort auto-attach off the PASSING scan. Fire-and-
          // forget: the cart opens immediately and the member band appears a
          // beat later when the server answers. Never overrides a member a
          // loaded website order already attached (AM-D), and a failed or
          // ambiguous match changes nothing — manual lookup still works.
          if (scannedName && onMemberMatch) {
            void onMemberMatch({ ...scannedName, dateOfBirth: v.dateOfBirth }).then((hit) => {
              if (hit) setMember((prev) => prev ?? hit);
            });
          }
        }}
        onEnqueueManual={(payload) => onEnqueue("manual_id_verification", payload)}
        onEnqueueCardCapture={(payload) => onEnqueue("medical_card_capture", payload)}
        onScanFinalized={noteScanFinalized}
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
        onProductImage={onProductImage}
        onStockFlag={onStockFlag}
        onLoyalty={onLoyalty}
        appliedLoyalty={appliedLoyalty}
        setAppliedLoyalty={setAppliedLoyalty}
        releaseLoyalty={releaseLoyalty}
        loyaltyFingerprint={loyaltyFingerprint}
        appliedSpecial={appliedSpecial}
        setAppliedSpecial={setAppliedSpecial}
        onWitness={onWitness}
        employeeId={employeeId}
        registerId={registerId}
        employeeName={employeeName}
        overrides={overrides}
        setOverrides={setOverrides}
        onCancel={() => {
          // AM-B — a cancelled sale returns the customer's points at once.
          releaseLoyalty(appliedLoyalty);
          onCancel();
        }}
        onHold={
          onHold
            ? (c) => {
                // AM-B — a saved sale reprices on load; the discount cannot
                // survive, so the code is released (points refunded) now.
                releaseLoyalty(appliedLoyalty);
                setAppliedLoyalty(null);
                onHold(c);
              }
            : undefined
        }
        heldSale={heldSale}
        onReleaseHold={onReleaseHold}
        onTender={(presetTenderedMinor) => {
          // AO-4 — a quick-tender chip carries the handed-over cash straight
          // into the tender screen; the plain button starts at $0.
          setInitialTendered(presetTenderedMinor ?? null);
          // SLICE 23 — draw the fun name NOW, while the customer is still
          // counting out cash, so it is already in hand when the sale is
          // enqueued a few seconds later and nothing has to wait on it.
          requestFunName();
          setStep("tender");
        }}
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
        appliedLoyalty={appliedLoyalty}
        appliedSpecial={appliedSpecial}
        initialTenderedMinor={initialTendered}
        onBack={() => setStep("cart")}
        onCancel={() => {
          releaseLoyalty(appliedLoyalty);
          onCancel();
        }}
        onPaid={(tenderedMinor) => {
          const base = priceForBuyer(cart, bundle, !!medicalCard, overrides);
          // AM-B — apply the server-computed loyalty spread to the FINAL
          // priced lines (the drift effect guarantees the fingerprint still
          // matches; a mismatch here would have dropped the discount).
          const loyaltyAdj = appliedLoyalty
            ? applyLoyaltyToPricedLines(base.lines, appliedLoyalty.perVariant)
            : null;
          // SLICE 28 — the special-discount reductions apply the same way
          // (never both; applying one cleared the other on the cart screen).
          const specialAdj =
            !appliedLoyalty && appliedSpecial
              ? applySpecialDiscountToPricedLines(base.lines, appliedSpecial.perLine)
              : null;
          const priced = {
            ...base,
            lines: loyaltyAdj ? loyaltyAdj.lines : specialAdj ? specialAdj.lines : base.lines,
            totals: loyaltyAdj ? loyaltyAdj.totals : specialAdj ? specialAdj.totals : base.totals,
          };
          // SLICE 23 — read the prefetched fun name ONCE, synchronously, and
          // use that single value for BOTH the payload and the frozen
          // receipt. Reading the ref twice could pick up a late arrival in
          // between and print one name while recording another, which is the
          // one way this feature could actually mislead somebody: the slip in
          // the customer's hand would disagree with the reprint.
          const funNameForSale = funNameRef.current;
          const built = buildSalePayload({
            lines: priced.lines,
            totals: priced.totals,
            tenderedMinor,
            drawerSessionId,
            // Omitted entirely when there is no name, so an offline sale's
            // payload stays byte-identical to its pre-Slice-23 shape.
            ...(funNameForSale ? { displayName: funNameForSale } : {}),
            idVerification:
              verdict.method === "manual" && manualEventUuid
                ? { method: "manual", manualEventUuid }
                : { method: "scan" },
            // Carry the source website order id (when this sale was loaded from
            // one) so the sync supersedes it ONLY on completion — never on load.
            ...(initialSourceOrderId ? { sourceOrderId: initialSourceOrderId } : {}),
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
            // AM-B — the redemption block: sync claims the code atomically
            // against the materialized order and writes the 0116 columns.
            ...(appliedLoyalty && loyaltyAdj && loyaltyAdj.appliedMinor > 0
              ? {
                  loyaltyRedemption: {
                    redemptionId: appliedLoyalty.redemptionId,
                    code: appliedLoyalty.code,
                    appliedMinor: loyaltyAdj.appliedMinor,
                  },
                }
              : {}),
            // SLICE 28 — the special-discount block: the sync re-runs every
            // program rule server-side and writes the 0133 use ledger.
            ...(appliedSpecial && specialAdj && specialAdj.appliedMinor > 0
              ? {
                  specialDiscount: {
                    kind: appliedSpecial.kind,
                    percentBps: appliedSpecial.percentBps,
                    appliedMinor: specialAdj.appliedMinor,
                    ...(appliedSpecial.beneficiaryEmployeeId
                      ? { beneficiaryEmployeeId: appliedSpecial.beneficiaryEmployeeId }
                      : {}),
                    ...(appliedSpecial.approvedByEmployeeId
                      ? { approvedByEmployeeId: appliedSpecial.approvedByEmployeeId }
                      : {}),
                    ...(appliedSpecial.companyName ? { companyName: appliedSpecial.companyName } : {}),
                    ...(appliedSpecial.militaryIdChecked === true ? { militaryIdChecked: true } : {}),
                  },
                }
              : {}),
            // B33 — the owner's cash-rounding policy from the bundle decides
            // the amount due; totals stay pre-rounded (tax on original price).
            rounding: normalizePosCashRoundingConfig(bundle.rounding),
          });
          if (!built.ok) return built.errors.join(" ");
          const saleUuid = onEnqueue("sale", built.payload as unknown as Record<string, unknown>);
          setChangeMinor(built.changeMinor);

          // ── SLICE 15 — the oversold variance, captured at the ONLY moment
          // it is still knowable ────────────────────────────────────────────
          //
          // The stored inventory level is clamped at zero by
          // sale-decrement-core.ts:217 (correct — state traceability cannot
          // receive a negative on-hand figure). But the clamp DESTROYS the
          // size of the shortfall: once pinned at 0 there is no way back to
          // "sold 2 against 1 tracked" from the level alone. So the variance
          // is computed here, from the cart as it actually stood, and frozen
          // with the same discipline the receipt is frozen with.
          //
          // Note this is driven by the NUMBERS, not by whether the override
          // toggle happened to be on: flipping the override and then selling
          // nothing past the count is not a variance, while a menu refresh
          // that lowered a count under an existing cart is one even though
          // nobody touched the switch.
          const variances = oversoldVariances(
            cart.map((e) => ({
              productName: e.product.name,
              variantLabel: e.product.variantLabel,
              quantity: e.quantity,
              unitsLeft: e.product.unitsLeft,
            })),
          );
          setCountPrompt(countPromptMessage(variances));
          // The DURABLE record is deliberately NOT written from here. The
          // server-side decrement already detects the same shortfall and
          // stamps it onto the sale's own order_events row
          // (sale-decrement-core.ts:213 → sale-decrement.ts:243), which is
          // what makes it traceable back to its source sale as
          // WAC 314-55-087(2)(b) requires. Enqueuing a second client-side
          // copy would create two records of one event that could disagree,
          // and the register's copy would be the less trustworthy of the two
          // (it reads a cached count, the server reads the live level). So
          // the register's job here is the COUNT COMMAND — NetSuite's zero-
          // count pattern — and the back office reads the recorded variance.
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
            // Slice 22b — the owner's receipt switches travel INSIDE the
            // frozen snapshot, so a reprint months later reproduces the
            // receipt as it was actually printed rather than as today's
            // settings would render it.
            showTaxBreakdown: rc.showTaxBreakdown,
            showLogo: rc.showLogo,
            logoWidth: rc.logoWidth,
            showReturnPolicy: rc.showReturnPolicy,
            returnPolicyText: rc.returnPolicyText,
            showItemDetail: rc.showItemDetail,
            showBarcode: rc.showBarcode,
            showSaleSummary: rc.showSaleSummary,
            // SLICE 23 — QR choice and the bottom logo ride inside the same
            // frozen snapshot, so a reprint months from now reproduces the
            // receipt as it was actually printed.
            useQrCode: rc.useQrCode,
            logoDataUri: rc.bottomLogoDataUri || null,
            logoWidthPx: rc.bottomLogoWidth,
            // SLICE 23 — the fun name printed UNDER the code. The QR itself
            // still encodes the REAL receipt number, because a scan has to
            // resolve to exactly one sale and fun names recycle by design.
            // null here means the caption falls back to the real number.
            displayName: funNameForSale,
            // Slice 22b — the rich fields ride along. priceCart() already
            // computed every one of these; this mapping used to drop them on
            // the floor. Nothing new is collected, and nothing new can fail:
            // each field is optional on PosReceiptLine.
            //
            // `category` is the one that matters most — without it the
            // receipt cannot itemize the cannabis excise separately from the
            // retail sales tax, which RCW 69.50.535(1)(a) requires.
            lines: priced.lines.map((l, i) => {
              const medLine = priced.med?.lines[i];
              return {
                productName: l.productName,
                quantity: l.quantity,
                unitPriceMinor: l.unitPriceMinor,
                regularPriceMinor: l.regularPriceMinor,
                medicalTaxOff: (medLine?.medicalSavingsMinor ?? 0) > 0,
                category: l.category,
                brand: l.brand ?? null,
                variantLabel: l.variantLabel ?? null,
                unitGrams: l.unitGrams ?? null,
                unitThcMg: l.unitThcMg ?? null,
                appliedLabel: l.appliedLabel ?? null,
                // Exemptions only exist on a CARDED medical sale; on a
                // recreational sale medLine is undefined and both stay false,
                // which is exactly right.
                salesExempt: medLine?.salesExempt === true,
                exciseExempt: medLine?.exciseExempt === true,
              };
            }),
            subtotalMinor: priced.totals.subtotalMinorUnits,
            taxMinor: priced.totals.estimatedTaxMinorUnits,
            totalMinor: priced.totals.totalMinorUnits,
            savingsMinor: priced.totals.savingsMinorUnits,
            medicalSavingsMinor: isMedical ? (priced.med?.medicalSavingsMinor ?? 0) : 0,
            medicalSale: isMedical,
            tenderedMinor,
            changeMinor: built.changeMinor,
            // B33 — cash-rounding disclosure: separate line + cash due, only
            // when the policy actually adjusted this sale.
            ...(built.roundingAdjustmentMinor !== 0
              ? {
                  roundingAdjustmentMinor: built.roundingAdjustmentMinor,
                  roundedDueMinor: built.dueMinor,
                }
              : {}),
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

  // done — B38: a celebratory brand-green moment (Square's "all set" energy).
  return (
    <Frame title="Sale complete" onCancel={onComplete} cancelLabel="Lock register">
      <div className="w-full max-w-md rounded-2xl border border-[var(--pos-accent-border)] bg-[var(--pos-accent-soft)] px-6 py-6 text-center">
        <p className="text-4xl" aria-hidden>
          ✅
        </p>
        <p className="mt-2 text-5xl font-bold text-[var(--pos-accent)]">{money(changeMinor ?? 0)} change</p>
      </div>
      {changeMinor != null && changeMinor > 0 ? <ChangePlan changeMinor={changeMinor} /> : null}
      {/* SLICE 15 — the count command. Placement and tone are taken from the
          research, not chosen by feel: Shopify POS and Lightspeed both warn
          about insufficient stock WITHOUT blocking the sale, and NetSuite's
          zero-count practice issues the count instruction at the moment of
          discovery. So this informs and instructs, and the lock button below
          stays unconditional. It is deliberately absent from the receipt —
          no source examined puts an inventory discrepancy in front of the
          customer, because it is an internal control record. */}
      {countPrompt ? (
        <div className="mt-4 w-full max-w-md rounded-2xl border border-[var(--pos-warn-border)] bg-[var(--pos-warn-soft)] px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--pos-warn)]">Count check needed</p>
          <p className="mt-1 text-sm font-semibold text-[var(--pos-warn)]">{countPrompt}</p>
          {/* Wording note: an earlier draft told staff the shortfall was
              logged "with your name". That was checked against the code and
              it is not true \u2014 the decrement runs server-side and stamps
              actor_label "system" (sale-decrement.ts), with the employee
              reachable through the sale itself. The promise was narrowed to
              what the system actually guarantees, because a reassurance the
              software does not honour is worse than no reassurance. */}
          <p className="mt-1.5 text-[11px] text-[var(--pos-text-muted)]">
            This sale is already recorded, and the shortfall is logged against it so the back office can trace it and
            reconcile the count. Just verify the physical count on the shelf.
          </p>
        </div>
      ) : null}
      <p className="mt-4 max-w-md text-center text-sm text-[var(--pos-text-muted)]">
        Count the change back to the customer. The sale is queued and will sync to the back office —
        the register locks when you tap below.
      </p>
      {receipt ? <ReceiptButtons receipt={receipt} /> : null}
      {receipt && onEmailReceipt ? <EmailReceiptPanel receipt={receipt} onEmailReceipt={onEmailReceipt} /> : null}
      <button
        type="button"
        onClick={onComplete}
        className="pos-tile mt-8 rounded-2xl bg-[var(--pos-accent)] px-10 py-5 text-xl font-bold text-[var(--pos-accent-ink)]"
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
      <p className="mt-4 rounded-xl border border-[var(--pos-accent-border)] bg-[var(--pos-accent-soft)] px-4 py-3 text-sm text-[var(--pos-accent)]">
        Receipt emailed. The address was used once and not saved.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pos-tile mt-4 rounded-2xl border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-8 py-4 text-lg font-semibold"
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
    <div className="mt-4 w-full max-w-md rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface)] p-4 text-left">
      <p className="text-sm font-semibold">Email this receipt (customer&apos;s request)</p>
      <p className="mt-1 text-xs text-[var(--pos-text-faint)]">
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
          className="min-w-0 flex-1 rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-4 py-3 text-base placeholder:text-[var(--pos-text-faint)] focus:border-[var(--pos-accent-border)] focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy}
          className="pos-tile rounded-xl bg-[var(--pos-accent)] px-5 py-3 text-base font-bold text-[var(--pos-accent-ink)] disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
      {note ? <p className="mt-2 text-sm text-[var(--pos-warn)]">{note}</p> : null}
      <button type="button" onClick={() => { setOpen(false); setEmail(""); setNote(null); }} className="mt-3 text-xs text-[var(--pos-text-faint)] underline">
        Never mind
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// POS B10 — receipt printing (Star PassPRNT + browser fallback)
// ---------------------------------------------------------------------------

/**
 * Print the receipt WITHOUT leaving the register (SLICE 10).
 *
 * This used to navigate to a `starpassprnt://` URL, which made iOS switch to
 * Star's PassPRNT app and then try to bounce back. That is what threw the
 * budtender out of the app mid-sale. It now calls the StarXpand plugin over
 * Bluetooth from inside this process, and only falls back to the old
 * app-switch when the native path genuinely is not available (a web build, or
 * an iPad whose printer has not been paired yet) - in which case the note
 * below tells the budtender exactly why the screen changed.
 *
 * Both paths render the SAME HTML, so a receipt cannot differ by transport.
 * Reprint is just tapping again: the snapshot is immutable, and a reprint
 * never opens the drawer.
 */
function ReceiptButtons({ receipt }: { receipt: PosReceiptInput }) {
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  const printStar = async () => {
    if (printing) return;
    setPrinting(true);
    setFallbackNote(null);
    try {
      const html = buildPosReceiptHtml(receipt);
      const outcome = await printReceipt(
        { html, openDrawer: true, jobKind: "sale" },
        getPairedPrinterIdentifier(),
      );
      // Success still gets a note when a fallback was used, so an app switch is
      // never silent. The sale is already saved either way.
      if (outcome.ok) {
        setFallbackNote(outcome.usedFallback ? outcome.message : null);
      } else {
        setFallbackNote(
          outcome.drawerMayBeShut
            ? `${outcome.message} The drawer did not open — use No Sale if you need it.`
            : outcome.message,
        );
      }
    } finally {
      setPrinting(false);
    }
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
          disabled={printing}
          className="pos-tile rounded-2xl bg-[var(--pos-accent)] px-8 py-4 text-lg font-bold text-[var(--pos-accent-ink)] disabled:opacity-60"
        >
          {printing ? "Printing…" : "Print receipt"}
        </button>
        <button
          type="button"
          onClick={printBrowser}
          className="pos-tile rounded-2xl border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-8 py-4 text-lg font-semibold text-[var(--pos-text)]"
        >
          Browser print
        </button>
      </div>
      <p className="max-w-md text-center text-xs text-[var(--pos-text-faint)]">
        “Print receipt” prints on the counter printer and pops the drawer without leaving this
        screen. Tap again to reprint. Use “Browser print” on a laptop, or if the counter printer
        is unavailable — the sale is already saved either way.
      </p>
      {fallbackNote ? <p className="text-xs text-[var(--pos-warn)]">{fallbackNote}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — ID gate
// ---------------------------------------------------------------------------

function IdGateScreen({
  medicalAvailable,
  employeeSawUsername,
  onPassed,
  onCancel,
  onEnqueueManual,
  onEnqueueCardCapture,
  onScanFinalized,
}: {
  /** True when the menu bundle carries the DOH medical config (B8). */
  medicalAvailable: boolean;
  /**
   * Slice 6 — signed-in employee's SAW username ONLY (never a password). Shown
   * at the medical-verify step so the budtender knows which SAW login to use.
   */
  employeeSawUsername: string | null;
  onPassed: (
    v: Extract<IdGateVerdict, { allowed: true }>,
    manualEventUuid: string | null,
    medicalCard: PosCardCapture | null,
    cardEventUuid: string | null,
    /**
     * AO-3 — name parsed off a PASSING scan (null for the manual path, which
     * never captures a name). Used only to ask the server for an unambiguous
     * loyalty-member match; never stored on the device.
     */
    scannedName: { firstName: string | null; lastName: string | null } | null,
  ) => void;
  onCancel: () => void;
  onEnqueueManual: (payload: Record<string, unknown>) => string;
  onEnqueueCardCapture: (payload: Record<string, unknown>) => string;
  /**
   * IDS-5 — called the moment a scan finalizes (before the flow leaves the
   * gate) so the parent can arm the burst-drain window that swallows the
   * scanner's trailing keystrokes.
   */
  onScanFinalized: () => void;
}) {
  const [mode, setMode] = useState<"scan" | "over40" | "manual">("scan");
  const [error, setError] = useState<string | null>(null);

  // Manual form state
  const [idType, setIdType] = useState<string>("");
  const [dob, setDob] = useState("");
  const [expiry, setExpiry] = useState("");
  const [reason, setReason] = useState("");
  const [photoMatch, setPhotoMatch] = useState(false);

  // HOUSE POLICY — over-40 visual verification: DOB only, typed as digits and
  // masked to MM/DD/YYYY on every keystroke (no slashes to hunt for).
  const [over40Dob, setOver40Dob] = useState("");
  const [over40IdType, setOver40IdType] = useState<string>("drivers_license");

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

  const submitScan = (raw: string) => {
    setError(null);
    const card = medical ? validateCard() : null;
    if (medical && !card) return;
    const parsed = parseAamvaPdf417(raw);
    if (!parsed.ok) {
      setError(`${parsed.error} If the barcode won't read, use manual verification.`);
      return;
    }
    // Carded patients may be 18–20 (RCW 69.50.357(1)); recreational is 21+.
    const v = evaluateScannedId(parsed.license, todayYmd, card ? 18 : 21);
    if (!v.allowed) {
      setError(v.reason);
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
    // AO-3 — hand the parsed name up so the sale can auto-attach the member.
    onPassed(v, null, card, cardUuid, { firstName: parsed.license.firstName, lastName: parsed.license.lastName });
  };

  // AP — hidden instant capture (replaces the visible textarea). Root cause
  // of the floor failure: an AAMVA payload BEGINS "@" + LF, and a wedge
  // scanner types LF as Enter — the old box submitted on the FIRST Enter, so
  // the parser saw "@" alone and failed with the @/ANSI header error while
  // the rest of the barcode crawled into the box (one React re-render per
  // keystroke ≈ the 5-second print). Now a document-level listener buffers
  // the burst in a ref (zero re-renders → instant) and treats Enter/Tab as
  // payload newlines. Keystrokes into form fields pass through.
  //
  // IDS-1/2 — CONTENT-DRIVEN completion. The DuraScan D760 in HID/keyboard
  // mode streams the ~300–1100-char PDF417 one keystroke at a time over
  // Bluetooth; the burst can STALL past a short idle window mid-stream. The
  // old fixed 300 ms timer fired during those stalls and finalized a
  // TRUNCATED buffer → parse failed while the rest of the barcode spilled in
  // as garbage (the "5–7 s then fails" bug). Now: the instant the buffer is
  // a gate-ready license (feedIdCaptureKey.complete — ANSI header + DBB +
  // DBA), we finalize IMMEDIATELY (perceived-instant), so we never wait on a
  // timer for a good scan. The idle timer is only a LONGER stall-proof
  // fallback (ID_CAPTURE_FALLBACK_IDLE_MS) for odd/partial encodings, and it
  // clears the buffer on a partial so no garbage carries into the next scan.
  const captureRef = useRef<IdCaptureState>(emptyIdCaptureState());
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // IDS-6 — dedicated hidden input SINK for the scanner keystrokes. Root cause
  // of the iOS "Select All" bubble (verified against the WebKit team's own
  // guidance, bug 231161: CSS -webkit-user-select / -webkit-touch-callout do
  // NOT reliably suppress the callout): the old capture read keydown at the
  // DOCUMENT level with NOTHING focused, so Safari treated the wedge burst as
  // an attempt to select/edit page content and surfaced the editing callout.
  // Giving the burst a real, focused (off-screen) editable target means iOS
  // routes the keystrokes into a normal text field instead of the page body,
  // so no page selection forms and no callout appears. We keep the field
  // emptied every keystroke so it never actually accumulates or scrolls.
  const scanSinkRef = useRef<HTMLInputElement | null>(null);
  const [receiving, setReceiving] = useState(false);
  const submitScanRef = useRef<(raw: string) => void>(() => {});
  const onScanFinalizedRef = useRef<() => void>(() => {});
  useEffect(() => {
    // Latest-ref pattern: the document listener always calls the freshest
    // submitScan (which closes over medical-card state) without re-binding.
    submitScanRef.current = submitScan;
    onScanFinalizedRef.current = onScanFinalized;
  });
  // SLICE 12 - Socket Mobile Application Mode.
  //
  // In keyboard-wedge mode the D760 TYPES the licence's 300-1100 characters
  // one at a time, which is why an ID scan takes about ten seconds. The SDK
  // hands us the whole payload at once, so this path SKIPS the keystroke
  // accumulator entirely - there is nothing to accumulate. It goes straight to
  // submitScan, exactly where finalizeNow() would have delivered it.
  //
  // While a Socket scanner is connected, `sdkOwnsScanning()` is true and the
  // keydown listener below stands down. That is what prevents the same licence
  // being processed twice on a host that keeps HID alive alongside the SDK -
  // and it is read at EVENT time, not bind time, so a scanner that connects
  // after this effect ran still silences the wedge.
  const socket = useSocketScanner({
    enabled: mode === "scan",
    onScan: (payload) => {
      // Arm the burst drain first, exactly as finalizeNow() does, so nothing
      // trailing the payload lands in a field behind the gate.
      onScanFinalizedRef.current();
      submitScanRef.current(payload);
    },
  });
  const sdkOwnsScanning = socket.sdkOwnsScanning;

  useEffect(() => {
    if (mode !== "scan") return;
    const finalizeNow = () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      const fin = finalizeIdCapture(captureRef.current);
      captureRef.current = fin.state;
      setReceiving(false);
      if (fin.payload) {
        // IDS-5 — arm the burst drain BEFORE we hand off, so the scanner's
        // trailing keystrokes (weight/eye color/address after DBB+DBA) are
        // swallowed by the parent guard instead of landing in the cart search.
        onScanFinalizedRef.current();
        submitScanRef.current(fin.payload);
      }
    };
    const sink = scanSinkRef.current;
    const onKeyDown = (e: KeyboardEvent) => {
      // SLICE 12 - the SDK owns scanning while a Socket scanner is connected,
      // so wedge keystrokes are not a scan. Checked HERE, inside the handler,
      // so the answer is current: this listener is bound once per `mode` and a
      // scanner may connect long afterwards. Note we return WITHOUT
      // preventDefault - manual typing must keep working normally.
      if (sdkOwnsScanning()) return;
      const t = e.target as HTMLElement | null;
      // Keystrokes into a REAL form field (the manual DOB inputs, etc.) pass
      // through untouched. The scan SINK is our own field — treat its keydowns
      // as scanner input, not as user typing.
      if (t !== sink) {
        const tag = t?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return;
      }
      const r = feedIdCaptureKey(captureRef.current, e.key, performance.now());
      captureRef.current = r.state;
      if (!r.consumed) return;
      e.preventDefault();
      // Keep the sink emptied so it never accumulates, scrolls, or forms a
      // selection (belt-and-suspenders with preventDefault).
      if (sink) sink.value = "";
      setReceiving((prev) => prev || true);
      // PRIMARY: the payload is provably complete — finalize instantly.
      if (r.complete) {
        finalizeNow();
        return;
      }
      // FALLBACK: (re)arm the long, stall-proof idle. It only fires when the
      // stream has genuinely ended without ever becoming gate-ready.
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(finalizeNow, ID_CAPTURE_FALLBACK_IDLE_MS);
    };
    document.addEventListener("keydown", onKeyDown);
    // Focus the sink so the wedge burst has a real editable target (no
    // document-level selection => no iOS "Select All" callout). Re-focus if
    // the user taps elsewhere and comes back.
    const focusSink = () => {
      if (mode === "scan" && scanSinkRef.current && document.activeElement !== scanSinkRef.current) {
        // Guard: never steal focus from the manual/over-40 form inputs.
        const ae = document.activeElement as HTMLElement | null;
        const aeTag = ae?.tagName;
        if (aeTag === "INPUT" || aeTag === "TEXTAREA" || aeTag === "SELECT" || ae?.isContentEditable) return;
        scanSinkRef.current.focus({ preventScroll: true });
      }
    };
    focusSink();
    const focusPoll = setInterval(focusSink, 400);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      clearInterval(focusPoll);
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      captureRef.current = emptyIdCaptureState();
    };
    // `sdkOwnsScanning` is a useCallback with no dependencies, so it is
    // referentially stable and listing it cannot cause this listener to
    // re-bind mid-scan. It is listed because it IS a dependency: omitting it
    // is how a stale ownership check gets baked into the closure.
  }, [mode, sdkOwnsScanning]);

  const submitManual = () => {
    setError(null);
    const card = medical ? validateCard() : null;
    if (medical && !card) return;
    // Inputs are digit-masked MM/DD/YYYY (house policy: numbers only) — the
    // core still speaks YYYY-MM-DD; an incomplete mask converts to "" and the
    // core's own error messages guide the fix.
    const dobYmd = mdyToYmd(dob) ?? "";
    const expYmd = mdyToYmd(expiry) ?? "";
    const v = evaluateManualId(
      { idType, dateOfBirth: dobYmd, expirationDate: expYmd, reason, photoMatchConfirmed: photoMatch },
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
      dateOfBirth: dobYmd,
      expirationDate: expYmd,
      reason: reason.trim(),
    });
    // Manual path has no machine-read name — no auto-attach (lookup still works).
    onPassed(v, uuid, card, cardUuid, null);
  };

  /**
   * HOUSE POLICY — over-40 visual verification. The budtender judged the
   * customer clearly 40+, checked the document is REAL and VALID in hand, and
   * enters ONLY the DOB. No expiration entry, no photo-match checkbox — but
   * the core still refuses if the DOB proves under 40 (scan instead), and the
   * WAC 314-55-150 audit event is enqueued exactly like any manual verify.
   */
  const submitOver40 = () => {
    setError(null);
    const card = medical ? validateCard() : null;
    if (medical && !card) return;
    const dobYmd = mdyToYmd(over40Dob);
    if (!dobYmd) {
      setError("Enter the full date of birth — numbers only, MM/DD/YYYY.");
      return;
    }
    const v = evaluateManualId(
      {
        idType: over40IdType,
        dateOfBirth: dobYmd,
        expirationDate: "",
        reason: OVER40_VISUAL_REASON,
        photoMatchConfirmed: false,
        visualOver40: true,
      },
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
      idType: over40IdType,
      dateOfBirth: dobYmd,
      expirationDate: "",
      reason: OVER40_VISUAL_REASON,
      visualOver40: true,
    });
    // Visual path has no machine-read name — no auto-attach (lookup still works).
    onPassed(v, uuid, card, cardUuid, null);
  };

  return (
    <Frame title="Check ID — required before anything enters the cart" onCancel={onCancel}>
      {/* HOUSE POLICY — the owner's rule, on screen before every sale:
          vertical ID always scans, under-40 always scans, clearly-40+ gets a
          visual validity check + DOB entry. "This is how we do it here." */}
      <div className="mb-4 w-full max-w-lg overflow-hidden rounded-2xl border-2 border-[var(--pos-accent-border)]">
        <p className="bg-[var(--pos-accent)] px-4 py-3 text-center text-xl font-black uppercase tracking-wide text-[var(--pos-accent-ink)]">
          ⚠ Vertical ID? It MUST be scanned.
        </p>
        <div className="grid grid-cols-2 divide-x divide-[var(--pos-border)] bg-[var(--pos-surface)] text-center">
          <div className="px-3 py-2.5">
            <p className="text-sm font-black uppercase">Under {OVER40_VISUAL_MIN_AGE}</p>
            <p className="mt-0.5 text-xs text-[var(--pos-text-muted)]">SCAN the ID. Every time.</p>
          </div>
          <div className="px-3 py-2.5">
            <p className="text-sm font-black uppercase">Clearly {OVER40_VISUAL_MIN_AGE}+</p>
            <p className="mt-0.5 text-xs text-[var(--pos-text-muted)]">Check the ID is real & valid · enter DOB.</p>
          </div>
        </div>
        <p className="border-t border-[var(--pos-border)] bg-[var(--pos-surface-2)] px-4 py-1.5 text-center text-[11px] font-bold uppercase tracking-wider text-[var(--pos-text-faint)]">
          This is how we do it here — no exceptions
        </p>
      </div>

      {error ? (
        <p className="mb-4 w-full max-w-lg rounded-lg border border-[var(--pos-danger-border)] bg-[var(--pos-danger-soft)] px-4 py-3 text-sm text-[var(--pos-danger)]">{error}</p>
      ) : null}

      {/* POS B9 — medical recognition card (RCW 69.51A.230). Captured AT the
          gate: it changes the age floor (18–20 patients), unlocks High-THC
          products, and passes the tax exemptions through to the price. */}
      <div className="mb-4 w-full max-w-lg rounded-xl border border-[var(--pos-border)] bg-[var(--pos-surface)] p-4">
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
          <p className="mt-2 text-xs text-[var(--pos-warn)]">
            Medical config not in the cached menu — refresh the menu while online to enable medical sales.
          </p>
        ) : null}
        {medical ? (
          <div className="mt-3 space-y-3">
            {/* Medical-sale checklist (DOH requires verifying the card in the
                MCR on EVERY sale — it can be revoked). Kept brief; the register
                only opens the medical path once the card facts are entered and
                the MCR check is attested below. */}
            <ol className="list-decimal space-y-1 rounded-xl border border-[var(--pos-border)] bg-[var(--pos-surface-2)] px-5 py-3 text-xs text-[var(--pos-text-muted)]">
              <li>Confirm the recognition-card NAME matches the ID you just verified.</li>
              <li>
                Verify the card is ACTIVE in the DOH registry (
                <a
                  href={SAW_LOGIN_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-[var(--pos-accent)] underline"
                >
                  open SAW ↗
                </a>
                ) — required every sale.
              </li>
              <li>Enter the card details below, then tick the verification box.</li>
            </ol>
            {/* Slice 6 — show THIS budtender their own SAW login so there's no
                "which login is this?" fumble on a rare medical sale. Username
                ONLY (never a password); MFA finishes on their own phone. */}
            {(() => {
              const sawUser = sanitizeSawUsername(employeeSawUsername);
              return (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--pos-border)] bg-[var(--pos-surface-2)] px-4 py-2 text-xs text-[var(--pos-text-muted)]">
                  {sawUser ? (
                    <>
                      <span>
                        Your SAW login:{" "}
                        <span className="font-mono font-semibold text-[var(--pos-text)]">{sawUser}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(sawUser).catch(() => {});
                        }}
                        className="rounded-lg border border-[var(--pos-border-strong)] px-2 py-1 font-semibold text-[var(--pos-accent)]"
                      >
                        Copy username
                      </button>
                      <span className="text-[var(--pos-text-faint)]">
                        Finish with the code SAW texts your phone.
                      </span>
                    </>
                  ) : (
                    <span>
                      Log in with <strong>your own</strong> SAW account. (Ask the owner to save your
                      SAW username on your employee file to show it here.)
                    </span>
                  )}
                </div>
              );
            })()}
            <div>
              <label htmlFor="pos-upid" className="text-sm text-[var(--pos-text-muted)]">
                Unique patient identifier (UPID) — exactly as printed on the card
              </label>
              <input
                id="pos-upid"
                value={upid}
                onChange={(e) => setUpid(e.target.value)}
                autoCapitalize="characters"
                className="mt-1 w-full rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] p-3 font-mono text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="pos-card-eff" className="text-sm text-[var(--pos-text-muted)]">Card effective (YYYY-MM-DD)</label>
                <input
                  id="pos-card-eff"
                  value={cardEffective}
                  onChange={(e) => setCardEffective(e.target.value)}
                  inputMode="numeric"
                  placeholder="2026-01-01"
                  className="mt-1 w-full rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] p-3 text-sm"
                />
              </div>
              <div>
                <label htmlFor="pos-card-exp" className="text-sm text-[var(--pos-text-muted)]">Card expires (YYYY-MM-DD)</label>
                <input
                  id="pos-card-exp"
                  value={cardExpires}
                  onChange={(e) => setCardExpires(e.target.value)}
                  inputMode="numeric"
                  placeholder="2027-01-01"
                  className="mt-1 w-full rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] p-3 text-sm"
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
        <div
          className="w-full max-w-lg"
          // IDS-5/6: suppressing selection + the iOS callout via CSS is a first
          // layer, but the REAL fix for the "Select All" bubble is the focused
          // hidden sink below (WebKit bug 231161: CSS alone does not reliably
          // suppress the callout).
          style={{
            userSelect: "none",
            WebkitUserSelect: "none",
            WebkitTouchCallout: "none",
          }}
        >
          {/* IDS-6: hidden, off-screen input SINK. The scanner burst is a rapid
              stream of keystrokes; with no focused editable target iOS Safari
              tries to select page content and shows the "Select All" callout.
              Keeping this field focused gives the burst a real target so no
              page selection forms. Kept empty on every keystroke. Off-screen
              (not display:none, which can't hold focus). */}
          <input
            ref={scanSinkRef}
            type="text"
            inputMode="none"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => { e.currentTarget.value = ""; }}
            onSelect={(e) => {
              const el = e.currentTarget;
              try { el.setSelectionRange(0, 0); } catch { /* ignore */ }
            }}
            style={{
              position: "absolute",
              width: 1,
              height: 1,
              padding: 0,
              margin: -1,
              opacity: 0,
              border: 0,
              left: -9999,
              top: 0,
              userSelect: "none",
              WebkitUserSelect: "none",
              WebkitTouchCallout: "none",
              caretColor: "transparent",
            }}
          />
          {/* AP — no box, no typing, no waiting: the hidden capture reads the
              scanner directly and the verdict lands ~a third of a second
              after the beep. */}
          <div
            aria-live="polite"
            className={`rounded-2xl border-2 p-8 text-center transition-colors ${
              receiving
                ? "border-[var(--pos-accent-border)] bg-[var(--pos-accent-soft)]"
                : "border-dashed border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)]"
            }`}
          >
            <span className="text-5xl" aria-hidden>
              {receiving ? "⚡" : "🪪"}
            </span>
            <p className="mt-3 text-xl font-extrabold tracking-tight">
              {receiving ? "Reading barcode…" : "Ready to scan"}
            </p>
            <p className="mt-1.5 text-sm text-[var(--pos-text-muted)]">
              {receiving
                ? "The verdict shows the instant the scan finishes."
                : "Point the scanner at the BIG barcode on the back of the license and pull the trigger. Nothing to tap — age and expiry check automatically."}
            </p>
          </div>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={() => {
                setMode("over40");
                setError(null);
              }}
              className="pos-tile rounded-xl border border-[var(--pos-accent-border)] bg-[var(--pos-accent-soft)] px-6 py-3 font-semibold text-[var(--pos-accent)]"
            >
              Clearly {OVER40_VISUAL_MIN_AGE}+ — visual check
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("manual");
                setError(null);
              }}
              className="pos-tile rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-6 py-3 font-semibold text-[var(--pos-text)]"
            >
              Other ID / won’t scan
            </button>
          </div>
        </div>
      ) : mode === "over40" ? (
        <div className="w-full max-w-lg space-y-4">
          <p className="text-sm text-[var(--pos-text-muted)]">
            Customer clearly looks {OVER40_VISUAL_MIN_AGE} or older. Hold the ID: real document, not
            expired, photo is this person. Then enter the date of birth exactly as shown — that’s it.
            (Audited; if the DOB says under {OVER40_VISUAL_MIN_AGE}, you’ll be sent back to scan.)
          </p>
          <div>
            <label htmlFor="pos-over40-idtype" className="text-sm text-[var(--pos-text-muted)]">Document type (WAC 314-55-150)</label>
            <select
              id="pos-over40-idtype"
              value={over40IdType}
              onChange={(e) => setOver40IdType(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] p-3 text-sm"
            >
              {ACCEPTABLE_ID_TYPES.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="pos-over40-dob" className="text-sm text-[var(--pos-text-muted)]">
              Date of birth — numbers only (MM/DD/YYYY)
            </label>
            <input
              id="pos-over40-dob"
              value={over40Dob}
              onChange={(e) => setOver40Dob(maskDateDigitsMdy(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitOver40();
              }}
              inputMode="numeric"
              autoFocus
              placeholder="MM/DD/YYYY"
              className="mt-1 w-full rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] p-3 text-center text-2xl font-bold tracking-widest"
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={submitOver40}
              disabled={mdyToYmd(over40Dob) === null}
              className="pos-tile rounded-xl bg-[var(--pos-accent)] px-6 py-3 font-semibold text-[var(--pos-accent-ink)] disabled:opacity-40"
            >
              Verify — clearly {OVER40_VISUAL_MIN_AGE}+
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("scan");
                setError(null);
              }}
              className="pos-tile rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-6 py-3 font-semibold text-[var(--pos-text)]"
            >
              Back to scanning
            </button>
          </div>
        </div>
      ) : (
        <div className="w-full max-w-lg space-y-4">
          <p className="text-sm text-[var(--pos-warn)]">
            Manual verifications are audited. Only use when the barcode will not scan or the document
            has no barcode (passport, tribal, armed forces…). Customer clearly {OVER40_VISUAL_MIN_AGE}+?
            Use the visual check instead — DOB only.
          </p>
          <div>
            <label htmlFor="pos-idtype" className="text-sm text-[var(--pos-text-muted)]">Document type (WAC 314-55-150)</label>
            <select
              id="pos-idtype"
              value={idType}
              onChange={(e) => setIdType(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] p-3 text-sm"
            >
              <option value="">— select —</option>
              {ACCEPTABLE_ID_TYPES.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="pos-dob" className="text-sm text-[var(--pos-text-muted)]">Date of birth — numbers only (MM/DD/YYYY)</label>
              <input
                id="pos-dob"
                value={dob}
                onChange={(e) => setDob(maskDateDigitsMdy(e.target.value))}
                inputMode="numeric"
                placeholder="MM/DD/YYYY"
                className="mt-1 w-full rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] p-3 text-sm"
              />
            </div>
            <div>
              <label htmlFor="pos-exp" className="text-sm text-[var(--pos-text-muted)]">Expiration date — numbers only (MM/DD/YYYY)</label>
              <input
                id="pos-exp"
                value={expiry}
                onChange={(e) => setExpiry(maskDateDigitsMdy(e.target.value))}
                inputMode="numeric"
                placeholder="MM/DD/YYYY"
                className="mt-1 w-full rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] p-3 text-sm"
              />
            </div>
          </div>
          <div>
            <label htmlFor="pos-reason" className="text-sm text-[var(--pos-text-muted)]">Why manual? (audited, 3–500 chars)</label>
            <input
              id="pos-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Barcode scratched — visual check of WA DL"
              className="mt-1 w-full rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] p-3 text-sm"
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
              className="pos-tile rounded-xl bg-[var(--pos-accent)] px-6 py-3 font-semibold text-[var(--pos-accent-ink)]"
            >
              Verify manually
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("scan");
                setError(null);
              }}
              className="pos-tile rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-6 py-3 font-semibold text-[var(--pos-text)]"
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
// B39 — quick-amount keypad (Square's Keypad tab, cannabis-lawful edition)
// ---------------------------------------------------------------------------

/**
 * Custom amounts are restricted to NON-CANNABIS categories (merch /
 * accessories) — every cannabis line must map to real menu inventory for
 * CCRS, excise, and purchase limits (see custom-sale-core.ts). The keypad
 * works like a cash register: digits shift in from the right.
 */
/**
 * B36/B40 — one product tile, shared by the menu grid and the Favorites page.
 * The ☆/★ in the corner pins the variant to this register's Favorites
 * (Square Favorites / Shopify smart grid); tapping anywhere else adds to cart.
 * The star is a sibling overlay, not a nested button — nested interactive
 * elements are invalid HTML and break tap targets.
 */
function ProductTile({
  product,
  pinned,
  onAdd,
  onTogglePin,
  onInfo,
}: {
  product: PosMenuProduct;
  pinned: boolean;
  onAdd: () => void;
  onTogglePin: () => void;
  /** B42 — open the product-info card (undefined = no affordance). */
  onInfo?: () => void;
}) {
  const style = categoryStyle(product.category);
  // SLICE 14 (owner decision Q1) — a variant the menu says is at zero is
  // GREYED OUT but still tappable: tapping explains "none left" rather than
  // doing nothing. A disabled button that silently eats taps is its own bug,
  // and hiding the product entirely makes staff think the menu is broken.
  // Only a TRUSTWORTHY zero greys a tile (isKnownOutOfStock ignores
  // null/undefined/corrupt counts), so custom sales and untracked items look
  // exactly as they did before.
  const outOfStock = isKnownOutOfStock(product.unitsLeft);
  return (
    <div className="relative h-full">
      <button
        type="button"
        onClick={onAdd}
        aria-disabled={outOfStock}
        data-out-of-stock={outOfStock ? "true" : undefined}
        className={`pos-tile flex h-full min-h-24 w-full flex-col rounded-xl border p-3 text-left ${
          outOfStock
            ? "border-dashed border-[var(--pos-border)] bg-[var(--pos-surface)] opacity-45 grayscale"
            : "border-[var(--pos-border)] bg-[var(--pos-surface-2)] active:bg-[var(--pos-surface-hover)]"
        }`}
      >
        <span className="flex items-center gap-1.5 pr-6 text-[10px] font-bold uppercase tracking-wide text-[var(--pos-text-faint)]">
          <span className={`h-2 w-2 rounded-full ${style.dot}`} aria-hidden />
          <span className="truncate capitalize">{product.category}</span>
        </span>
        <span className="mt-1 block text-sm font-semibold leading-snug">
          {product.name}
          {product.variantLabel ? <span className="text-[var(--pos-text-muted)]"> · {product.variantLabel}</span> : null}
          <StockBadge product={product} />
          <ClassificationBadge product={product} />
        </span>
        {product.brand ? (
          <span className="mt-0.5 block truncate text-xs text-[var(--pos-text-faint)]">{product.brand}</span>
        ) : null}
        <span className="mt-auto block pt-2 text-base font-bold text-[var(--pos-accent)]">
          {money(product.regularPriceMinor)}
        </span>
      </button>
      <button
        type="button"
        onClick={onTogglePin}
        aria-label={pinned ? "Unpin from favorites" : "Pin to favorites"}
        title={pinned ? "Unpin from favorites" : "Pin to favorites"}
        className={`absolute right-0.5 top-0.5 flex h-9 w-9 items-center justify-center rounded-full text-base leading-none ${
          pinned ? "text-[var(--pos-accent)]" : "text-[var(--pos-text-faint)] opacity-60"
        }`}
      >
        {pinned ? "★" : "☆"}
      </button>
      {onInfo ? (
        <button
          type="button"
          onClick={onInfo}
          aria-label={`Product info for ${product.name}`}
          title="Product info"
          className="absolute bottom-0.5 right-0.5 flex h-9 w-9 items-center justify-center rounded-full text-base font-semibold leading-none text-[var(--pos-text-faint)] opacity-70"
        >
          ⓘ
        </button>
      ) : null}
    </div>
  );
}

function KeyButton({ label, onPress, wide }: { label: string; onPress: () => void; wide?: boolean }) {
  return (
    <button
      type="button"
      onClick={onPress}
      className={`pos-tile rounded-xl border border-[var(--pos-border)] bg-[var(--pos-surface-2)] py-4 text-xl font-bold text-[var(--pos-text)] ${wide ? "col-span-2" : ""}`}
    >
      {label}
    </button>
  );
}

function KeypadPanel({ onAdd }: { onAdd: (product: PosMenuProduct) => void }) {
  const [amountMinor, setAmountMinor] = useState(0);
  const [kpCategory, setKpCategory] = useState<CustomSaleCategory>("merch");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addLine = () => {
    setError(null);
    const built = buildCustomProduct({
      category: kpCategory,
      amountMinor,
      note,
      uid: crypto.randomUUID(),
    });
    if (!built.ok) {
      setError(built.errors.join(" "));
      return;
    }
    onAdd(built.product);
    setAmountMinor(keypadClear());
    setNote("");
  };

  return (
    <div className="mx-auto w-full max-w-sm">
      <p className="rounded-lg border border-[var(--pos-border)] bg-[var(--pos-surface-2)] px-3 py-2 text-xs text-[var(--pos-text-muted)]">
        Non-cannabis only (merch &amp; accessories) — cannabis must be rung from the menu so
        inventory, excise, and limits stay exact.
      </p>
      <div className="mt-3 rounded-xl border border-[var(--pos-accent-border)] bg-[var(--pos-accent-soft)] px-4 py-3 text-center">
        <span className="text-4xl font-bold tabular-nums text-[var(--pos-accent)]">{money(amountMinor)}</span>
      </div>
      <div className="mt-3 flex gap-2">
        {CUSTOM_SALE_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setKpCategory(c)}
            className={`flex-1 rounded-full px-3 py-2 text-sm font-semibold capitalize ${
              kpCategory === c
                ? "bg-[var(--pos-accent)] text-[var(--pos-accent-ink)]"
                : "border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] text-[var(--pos-text-muted)]"
            }`}
          >
            {c}
          </button>
        ))}
      </div>
      <input
        value={note}
        maxLength={MAX_CUSTOM_NOTE_LENGTH}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What is it? (optional — prints on the receipt)"
        className="mt-3 w-full rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] p-3 text-sm"
      />
      <div className="mt-3 grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <KeyButton key={d} label={d} onPress={() => setAmountMinor((a) => keypadAppend(a, Number(d)))} />
        ))}
        <KeyButton label="C" onPress={() => setAmountMinor(keypadClear())} />
        <KeyButton label="0" onPress={() => setAmountMinor((a) => keypadAppend(a, 0))} />
        <KeyButton label="⌫" onPress={() => setAmountMinor((a) => keypadBackspace(a))} />
      </div>
      {error ? (
        <p className="mt-3 rounded-lg border border-[var(--pos-danger-border)] bg-[var(--pos-danger-soft)] px-3 py-2 text-xs font-semibold text-[var(--pos-danger)]">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={addLine}
        disabled={amountMinor < 1}
        className="pos-tile mt-3 w-full rounded-xl bg-[var(--pos-accent)] py-3 text-base font-bold text-[var(--pos-accent-ink)] disabled:opacity-40"
      >
        Add to check
      </button>
    </div>
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
  onProductImage,
  onStockFlag,
  onLoyalty,
  appliedLoyalty,
  setAppliedLoyalty,
  releaseLoyalty,
  loyaltyFingerprint,
  appliedSpecial,
  setAppliedSpecial,
  onWitness,
  employeeId,
  registerId,
  employeeName,
  overrides,
  setOverrides,
  onCancel,
  onHold,
  heldSale,
  onReleaseHold,
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
  /** B42 — info-card photo resolve (ONLINE-ONLY via the shell). */
  onProductImage?: (productId: string) => Promise<{ url: string; isFallback: boolean } | null>;
  /** B43 — out-of-stock quick-flag (ONLINE-ONLY via the shell; one-way). */
  onStockFlag?: (productId: string, reason: StockFlagReason) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** AM-B — loyalty redemption via /api/pos/loyalty (ONLINE-ONLY via the shell). */
  onLoyalty?: (
    req: PosLoyaltyRequest,
  ) => Promise<{ ok: true; grant: PosLoyaltyGrant } | { ok: false; error: string }>;
  /** AM-B — the redemption applied to this sale (null = none). */
  appliedLoyalty: AppliedLoyalty | null;
  setAppliedLoyalty: (a: AppliedLoyalty | null) => void;
  /** AM-B — release a points-issued code (refund) when the discount drops. */
  releaseLoyalty: (a: AppliedLoyalty | null) => void;
  /** AM-B — fingerprint of the CURRENT priced cart (stale-spread guard). */
  loyaltyFingerprint: string;
  /** SLICE 28 — the special discount applied to this sale (null = none). */
  appliedSpecial: AppliedSpecialDiscount | null;
  setAppliedSpecial: (a: AppliedSpecialDiscount | null) => void;
  /** SLICE 28 — employee-identity PIN check (ONLINE-ONLY; /api/pos/witness via the shell). */
  onWitness?: (pin: string) => Promise<{ ok: true; employee: { id: string; fullName: string } } | { ok: false; error: string }>;
  /** SLICE 28 — the unlocked cashier's employees.id (employee-program rules). */
  employeeId?: string;
  /** SLICE 28 — this device's register id (employee-program rules). */
  registerId?: string;
  /** SLICE 28 — the cashier's display name (shown in the employee-program picker). */
  employeeName?: string;
  /** B24 — this sale's manager price overrides, keyed by variantId. */
  overrides: Record<string, PosLineOverride>;
  setOverrides: (o: Record<string, PosLineOverride>) => void;
  onCancel: () => void;
  /** B17 — park the cart (undefined = a hold already exists; button hidden). */
  onHold?: (cart: PosCartEntry[]) => void;
  /** Saved-cart smart release — the device's parked hold (null when none, or
      when THIS sale is the resumed hold — it never conflicts with itself). */
  heldSale?: HeldSale | null;
  /** Saved-cart smart release — delete the parked hold (home-screen Discard
      semantics), offered right at the conflict moment. */
  onReleaseHold?: () => void;
  /**
   * AO-4 — advance to the tender screen. A quick-tender chip passes the
   * cash amount the customer handed over so the tender screen opens with
   * it already entered; undefined = start at $0 as before.
   */
  onTender: (presetTenderedMinor?: number) => void;
}) {
  const [query, setQuery] = useState("");
  // B36 — the active category filter chip (null = All).
  const [category, setCategory] = useState<string | null>(null);
  // SLICE 18D — the classification lane the budtender has narrowed to, or null
  // for "no classification filter". Independent of the category chip: "flower"
  // and "suppository" answer different questions, so they compose rather than
  // replace each other.
  const [classification, setClassification] = useState<PosClassificationKind | null>(null);
  // B39/B40 — which browse surface is showing: item grid, favorites, keypad.
  const [browseTab, setBrowseTab] = useState<"menu" | "favorites" | "keypad">("menu");
  // B40 — pinned variantIds for THIS register, hydrated from localStorage
  // (per-device by design: the drive-thru window pins different best-sellers
  // than the main counter, and pins must work offline).
  const [favorites, setFavorites] = useState<string[]>([]);
  // Mount-time hydration from localStorage (an external store) — SSR cannot
  // read it, and reading window in the useState initializer would cause a
  // hydration mismatch. Same one-time burst RegisterShell uses at boot.
  /* eslint-disable-next-line react-hooks/set-state-in-effect */
  useEffect(() => setFavorites(parseFavorites(posStorageGet(FAVORITES_KEY))), []);
  const togglePin = (variantId: string) => {
    // GW-008 (same family as GW-003/GW-001) — compute the next value BEFORE
    // setState so the updater stays PURE (React may re-invoke updaters), and
    // guard the write: a quota/private-mode throw must degrade to "the pin
    // didn't stick past a restart", never crash the cart screen mid-sale.
    const next = toggleFavorite(favorites, variantId);
    try {
      posStorageSet(FAVORITES_KEY, serializeFavorites(next));
    } catch {
      // Best-effort — the pin still works for this session from state.
    }
    setFavorites(next);
  };
  // B40 — pins resolve against the LIVE bundle every render: prices/stock are
  // always current and a delisted product never shows a tile.
  const favoriteTiles = useMemo(() => favoriteProducts(bundle.products, favorites), [bundle.products, favorites]);
  // B37 — the check line whose in-place editor is open (Toast-style: tap a
  // line to edit; the row expands with qty stepper / remove / override).
  const [expandedLine, setExpandedLine] = useState<string | null>(null);
  // B24 — the line the manager is overriding (engine-priced snapshot).
  const [overrideTarget, setOverrideTarget] = useState<{ product: PosMenuProduct; engineLine: PricedSaleLine } | null>(null);
  // B23 — a scan that matched a MULTI-variant product: the cashier picks the
  // size (we never guess which variant left the shelf).
  const [scanPick, setScanPick] = useState<PosMenuProduct[] | null>(null);
  const [scanFlash, setScanFlash] = useState<string | null>(null);
  // AO-4 — the variant the LAST scan added, so its check row can wear the
  // mockup's "JUST SCANNED" tag until the next scan replaces it.
  const [lastScannedId, setLastScannedId] = useState<string | null>(null);
  // AM-A — a global-wedge scan that matched nothing (typo'd label, item not
  // on the menu). Surfaced loudly; a silent miss looks like a broken scanner.
  const [scanMiss, setScanMiss] = useState<string | null>(null);
  // AM-A — the on-demand browse overlay (menu grid / favorites / keypad).
  const [browseOpen, setBrowseOpen] = useState(false);
  // B41 — scan-required mode. `scanUnlocked` is manager-lifted for THIS SALE
  // only: the register locks after every sale (owner rule), which unmounts
  // this screen, so an unlock can never leak into the next customer.
  const scanRequiredOn = bundle.scanRequired?.enabled === true;
  const [scanUnlocked, setScanUnlocked] = useState(false);
  const [scanBlockNotice, setScanBlockNotice] = useState<string | null>(null);
  /**
   * SLICE 14 — "Sell anyway": the budtender takes responsibility for selling
   * past the CACHED count. The menu bundle is a snapshot, not a live query
   * (see stock-ceiling-core header), so a unit really can be in hand while the
   * count says zero. Owner decision Q2: ANY staff member may do this, so there
   * is deliberately no PIN here — the manager-locked overrides (scan-required,
   * price override) are untouched. Scoped to THIS sale and never persisted:
   * the next customer starts enforced again.
   */
  const [stockOverride, setStockOverride] = useState(false);
  // SLICE 15 FIX A — the refusal that is ALSO the way out. Holds the reason
  // string for the item that was just refused; rendering it draws the
  // "Sell anyway" button right next to the explanation. Cleared when the
  // override is taken, or dismissed. Any staff member may use it (owner
  // decision Q2) — no PIN, unlike the scan-required and price overrides.
  const [stockOverrideOffer, setStockOverrideOffer] = useState<string | null>(null);
  /** Units of a variant already in the cart (0 when absent). */
  const cartQtyOf = (variantId: string) =>
    cart.find((e) => e.product.variantId === variantId)?.quantity ?? 0;
  const [scanUnlockOpen, setScanUnlockOpen] = useState(false);
  // B42 — the product whose info card is open (Cova: info on demand).
  const [infoProduct, setInfoProduct] = useState<PosMenuProduct | null>(null);
  const carded = !!medicalCard;

  /**
   * B41 — every MANUAL add (menu tile, favorites tile, keypad) funnels
   * through this guard. Scanning bypasses it by design — tryScan and the
   * scan size-pick call setCart directly; the scan IS the proof.
   */
  const manualAdd = (p: PosMenuProduct) => {
    if (manualAddBlocked(bundle.scanRequired, scanUnlocked, p)) {
      setScanBlockNotice(
        `${p.name} is a cannabis item — scan its package barcode to add it. (Manager PIN can lift this for one sale.)`,
      );
      return;
    }
    // SLICE 14 — refuse politely and SAY WHY. The owner's report was a tile
    // reading "1 LEFT" that accepted a second tap; now the second tap explains
    // itself instead of silently doing nothing. Override is per-sale and open
    // to ANY staff member (owner decision Q2) — unlike the scan-required and
    // price-override rules above, which stay manager-locked.
    if (!canAddOne(cartQtyOf(p.variantId), p.unitsLeft, stockOverride)) {
      const label = p.variantLabel ? `${p.name} (${p.variantLabel})` : p.name;
      // SLICE 15 FIX A — Slice 14 told staff to "Use Sell anyway" while the
      // ONLY such button lived in a panel gated on stockBlocks.length > 0,
      // which the Phase-2 clamp makes unreachable. The owner could not find
      // it, and he was right: it was not there. The refusal now CARRIES the
      // override with it, so the way out is wherever the block happens.
      setStockOverrideOffer(stockRefusalMessage(label, p.unitsLeft));
      return;
    }
    setCart(addToCart(cart, p, stockOverride));
  };

  // B36 — category chips from the cached menu (busiest categories first).
  const chips = useMemo(() => menuCategoryChips(bundle.products), [bundle.products]);
  // B36 — search + chip combine; tile grids breathe better than lists, so the
  // cap rises 30 → 60 (still bounded: an iPad renders 60 tiles instantly).
  // SLICE 18D — classification chips derived from the products actually in the
  // bundle. A lane with no qualifying stock is omitted entirely, so a chip
  // never promises inventory the store does not have.
  const classificationChips = useMemo(
    () => posClassificationChips(bundle.products),
    [bundle.products],
  );
  /**
   * SLICE 18D — the classification filter ACTUALLY in force.
   *
   * Derived rather than read straight from state, because the chip row only
   * renders lanes that currently have stock. If the last low-THC beverage
   * sells out and the bundle re-syncs, that chip disappears — and a raw state
   * read would leave an INVISIBLE filter pinned on, showing an empty grid with
   * no control on screen to clear it. The budtender would reasonably conclude
   * the register had lost the menu.
   *
   * This is the same hazard the AM-A comment below describes for the category
   * chip, so it gets the same answer: a filter you cannot see is not applied.
   * Deriving (instead of an effect) means there is no frame where the stale
   * lane is still filtering.
   */
  const activeClassification = useMemo(
    () =>
      classification && classificationChips.some((c) => c.kind === classification)
        ? classification
        : null,
    [classification, classificationChips],
  );
  const results = useMemo(
    () => filterMenuProducts(bundle.products, query, category, activeClassification).slice(0, 60),
    [bundle.products, query, category, activeClassification],
  );
  // AM-A — main-screen quick-search rows ignore the overlay's category chip:
  // an invisible filter on the main screen would look like missing products.
  const quickResults = useMemo(
    () => filterMenuProducts(bundle.products, query, null).slice(0, 6),
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
      setLastScannedId(resolved.product.variantId);
      setScanMiss(null);
      setQuery("");
      return;
    }
    if (resolved.status === "pick") {
      setScanPick(resolved.candidates);
      setScanFlash(null);
      setScanMiss(null);
      setQuery("");
    }
    // none: keep the text — it's a search query, not a barcode.
  };

  /**
   * AM-A — handle a GLOBAL wedge scan (captured with nothing focused).
   * Same resolveScan path as the search box; a miss is reported loudly.
   * A hit closes the browse overlay so the cashier sees the item land.
   */
  const handleGlobalScan = useCallback(
    (code: string) => {
      const resolved = resolveScan(bundle.products, bundle.barcodes, code);
      if (resolved.status === "add") {
        setCart(addToCart(cart, resolved.product));
        setScanFlash(`Scanned: ${resolved.product.name}${resolved.product.variantLabel ? ` · ${resolved.product.variantLabel}` : ""}`);
        setLastScannedId(resolved.product.variantId);
        setScanMiss(null);
        setBrowseOpen(false);
        return;
      }
      if (resolved.status === "pick") {
        setScanPick(resolved.candidates);
        setScanFlash(null);
        setScanMiss(null);
        setBrowseOpen(false);
        return;
      }
      setScanMiss(`Barcode "${code}" matched nothing on the menu — check the label or search by name.`);
    },
    [bundle.products, bundle.barcodes, cart, setCart],
  );

  // AM-A — document-level wedge capture: fast keystroke bursts ending in
  // Enter are scans even when NOTHING is focused (the owner's "scan without
  // pushing any buttons"). Keystrokes going INTO an input/textarea/select
  // are ignored — the search box (Enter-to-scan) and modal fields keep
  // their own behavior; this listener only owns the dead space.
  const wedgeRef = useRef<WedgeState>(emptyWedgeState());

  // SLICE 12 - the same scanner, delivering whole payloads instead of typing
  // them. An ID that reaches the CART (a customer handing over a licence
  // instead of a package) is routed back through handleGlobalScan's caller
  // only if it is a product; a licence at this stage is ignored rather than
  // looked up as a barcode, which would tell the cashier the customer's ID
  // "matched nothing on the menu" and send them hunting in the wrong place.
  const socket = useSocketScanner({
    enabled: true,
    onScan: (payload, route) => {
      if (route !== "product") return;
      handleGlobalScan(payload);
    },
  });
  const sdkOwnsScanning = socket.sdkOwnsScanning;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // SLICE 12 - stand down while the SDK owns scanning, so one physical
      // scan cannot be added to the cart twice. Read at EVENT time: this
      // listener is bound once and the scanner may connect later.
      if (sdkOwnsScanning()) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return;
      const r = wedgeKey(wedgeRef.current, e.key, performance.now());
      wedgeRef.current = r.state;
      if (r.scan) {
        e.preventDefault();
        handleGlobalScan(r.scan);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [handleGlobalScan, sdkOwnsScanning]);
  const priced = useMemo(() => priceForBuyer(cart, bundle, carded, overrides), [cart, bundle, carded, overrides]);
  // AM-B — the loyalty-reduced view of the money (the check keeps showing
  // per-line engine prices; the rail's totals show what the customer owes).
  const loyaltyView = useMemo(
    () => (appliedLoyalty ? applyLoyaltyToPricedLines(priced.lines, appliedLoyalty.perVariant) : null),
    [priced.lines, appliedLoyalty],
  );
  // SLICE 28 — the special-discount-reduced view (same shape as loyaltyView;
  // the two never coexist — applying one clears the other, no stacking).
  const specialView = useMemo(
    () => (appliedSpecial ? applySpecialDiscountToPricedLines(priced.lines, appliedSpecial.perLine) : null),
    [priced.lines, appliedSpecial],
  );
  const railTotals = loyaltyView ? loyaltyView.totals : specialView ? specialView.totals : priced.totals;

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

  // Saved-cart smart release — live-cart lines the SAVED sale is competing
  // with (the menu's count can't cover both carts). The shell passes
  // heldSale = null when THIS sale is the resumed hold, so a hold never
  // conflicts with itself. Advisory + one-tap release; never blocks.
  const heldConflicts = useMemo(
    () =>
      heldStockConflicts(
        cart.map((e) => ({
          variantId: e.product.variantId,
          productName: e.product.name,
          variantLabel: e.product.variantLabel,
          quantity: e.quantity,
          unitsLeft: e.product.unitsLeft,
        })),
        heldSale,
      ),
    [cart, heldSale],
  );
  const heldSummary = useMemo(
    () => (heldSale ? describeHeldLines(heldSale, bundle.products) : ""),
    [heldSale, bundle.products],
  );

  // High-THC statutory lock (chapter 246-70 WAC): applyMedicalPricing flags
  // any cart line a NON-carded buyer cannot receive; no override exists.
  const highThcViolations = priced.med?.highThcViolations ?? [];

  // SLICE 14 — the LAST line of defence on stock. The add paths are guarded,
  // but a cart can go over WITHOUT any cart mutation: a menu refresh can lower
  // unitsLeft underneath a cart that was legal when it was built, and the
  // resume/hold rebuild paths re-hydrate lines against a newer bundle. So this
  // is evaluated from live cart state at tender time. Empty array = safe.
  const stockBlocks = useMemo(
    () =>
      stockOverride
        ? []
        : stockBlockingLines(
            cart.map((e) => ({
              productName: e.product.name,
              variantLabel: e.product.variantLabel,
              quantity: e.quantity,
              unitsLeft: e.product.unitsLeft,
            })),
          ),
    [cart, stockOverride],
  );

  const canTender =
    cart.length > 0 &&
    priced.problems.length === 0 &&
    !limits.blocked &&
    highThcViolations.length === 0 &&
    stockBlocks.length === 0;

  // SLICE 14 (owner decision Q3) — show WHEN the stock numbers were last
  // refreshed, using the SAME format already used for the menu timestamp at
  // the header and the settings panel, so the register never speaks about
  // time in two different dialects. Guarded: a corrupt/absent timestamp
  // degrades to plain wording instead of rendering "Invalid Date".
  const menuAgeLabel = useMemo(() => {
    const ms = Date.parse(bundle.fetchedAt);
    if (Number.isNaN(ms)) return "when the menu was last downloaded";
    return `at ${new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  }, [bundle.fetchedAt]);

  // AO-4 — quick-tender chips for the rail (mockup: "$130 / $140 / $150 /
  // Exact"). Built from the SAME B31 smart suggestions and B33 cash-rounded
  // due the tender screen uses, so the chip amount and the change math can
  // never disagree. Exact first (it's suggestion[0]), then up to three
  // realistic bill amounts.
  const quickTender = useMemo(() => {
    const roundingCfg = normalizePosCashRoundingConfig(bundle.rounding);
    const dueMinor = roundCashDue(railTotals.totalMinorUnits, roundingCfg.mode)?.dueMinor ?? railTotals.totalMinorUnits;
    const suggestions = smartTenderSuggestions(dueMinor);
    const chips = suggestions.slice(0, 4).map((amt, i) => ({
      label: i === 0 ? "Exact" : money(amt),
      amountMinor: amt,
    }));
    return { dueMinor, chips };
  }, [bundle.rounding, railTotals.totalMinorUnits]);

  return (
    // AL-A — full-height app layout (Square/Toast/Dynamics anatomy): at lg+
    // the register OWNS the viewport (h-dvh, no page scroll) and the browse
    // grid + check list scroll INTERNALLY. Below lg (narrow/portrait) the
    // panes stack and the page scrolls like before.
    <main className="pos-shell flex min-h-screen flex-col p-4 sm:p-6 lg:h-dvh lg:min-h-0 lg:overflow-hidden">
      {/* AO-4 — the customer band (owner-approved register.html mockup): the
          person owns the top of the screen. Name (or walk-in), ID✓age,
          MEDICAL and tier/points badges on the left; History / Hold / Cancel
          chips on the right; "THE USUAL" one-tap re-add chips (B29 history)
          underneath. Everything below prices against the attached member. */}
      <CustomerBand
        member={member}
        setMember={setMember}
        onMemberLookup={onMemberLookup}
        onMemberHistory={onMemberHistory}
        verdict={verdict}
        medicalCard={medicalCard}
        menuFetchedAt={bundle.fetchedAt}
        products={bundle.products}
        onAddUsual={(p) => manualAdd(p)}
        holdDisabled={cart.length === 0}
        onHold={onHold ? () => onHold(cart) : undefined}
        onCancel={onCancel}
      />

      {/* AM-A — the register's main surface (owner + Dutchie/Flowhub
          examples): a LARGE item area where scans land, and the checkout
          rail. The browse grid moved to an on-demand overlay — scanning is
          how items enter; browsing is the exception, not the layout. */}
      <div className="mt-3 grid flex-1 gap-4 lg:min-h-0 lg:grid-cols-[3fr_2fr]">
        <section className="flex flex-col rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface)] p-4 lg:min-h-0">
          {/* AM-A — always-live scan/search bar on the MAIN screen. Wedge
              scanners need NO click: a document-level listener
              (wedge-scan-core) catches fast keystroke bursts ending in
              Enter even when nothing is focused. */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg" aria-hidden>
                🔍
              </span>
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (scanFlash) setScanFlash(null);
                  if (scanMiss) setScanMiss(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && query.trim().length > 0) {
                    e.preventDefault();
                    tryScan();
                  }
                }}
                placeholder="Scan a barcode (no click needed) or search name, brand, size…"
                className="w-full rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] py-3 pl-10 pr-3 text-base focus:border-[var(--pos-accent-border)] focus:outline-none"
              />
            </div>
            {scanRequiredOn ? (
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
                    scanUnlocked
                      ? "border-[var(--pos-warn-border)] bg-[var(--pos-warn-soft)] text-[var(--pos-warn)]"
                      : "border-[var(--pos-accent-border)] bg-[var(--pos-accent-soft)] text-[var(--pos-accent)]"
                  }`}
                >
                  {scanUnlocked ? "Scan lifted (this sale)" : "Scan required"}
                </span>
                {!scanUnlocked && onApprove ? (
                  <button
                    type="button"
                    onClick={() => setScanUnlockOpen(true)}
                    className="pos-tile min-h-11 rounded-full border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--pos-text-muted)]"
                  >
                    Manager unlock
                  </button>
                ) : null}
              </span>
            ) : null}
          </div>
          {scanBlockNotice ? (
            <div className="mt-2 flex items-start justify-between gap-3 rounded-xl border border-[var(--pos-warn-border)] bg-[var(--pos-warn-soft)] px-3 py-2">
              <p className="text-xs font-semibold text-[var(--pos-warn)]">{scanBlockNotice}</p>
              <button type="button" onClick={() => setScanBlockNotice(null)} aria-label="Dismiss" className="text-xs font-bold text-[var(--pos-warn-muted)]">
                ✕
              </button>
            </div>
          ) : null}
          <StockOverrideOffer
            offer={stockOverrideOffer}
            menuAgeLabel={menuAgeLabel}
            onOverride={() => {
              setStockOverride(true);
              setStockOverrideOffer(null);
              setScanBlockNotice(null);
            }}
            onDismiss={() => setStockOverrideOffer(null)}
          />
          {scanFlash ? (
            <p className="mt-2 rounded-lg border border-[var(--pos-accent-border)] bg-[var(--pos-accent-soft)] px-3 py-2 text-xs font-semibold text-[var(--pos-accent)]">
              {scanFlash} — added to sale
            </p>
          ) : null}
          {scanMiss ? (
            <p className="mt-2 rounded-lg border border-[var(--pos-warn-border)] bg-[var(--pos-warn-soft)] px-3 py-2 text-xs font-semibold text-[var(--pos-warn)]">
              {scanMiss}
            </p>
          ) : null}
          {scanPick ? (
            <div className="mt-2 rounded-xl border border-[var(--pos-info-border)] bg-[var(--pos-info-soft)] p-3">
              <p className="text-xs font-semibold text-[var(--pos-info)]">
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
                      setLastScannedId(p.variantId);
                      setScanPick(null);
                    }}
                    className="min-h-11 rounded-full bg-[var(--pos-info-solid)] px-4 py-2 text-sm font-bold text-white"
                  >
                    {p.variantLabel ?? "each"} · {money(p.regularPriceMinor)}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setScanPick(null)}
                  className="pos-tile min-h-11 rounded-full border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-4 py-2 text-sm font-semibold text-[var(--pos-text)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          {/* AM-A — quick search results: typing shows tap-to-add rows right
              here (search never leaves the main screen). */}
          {query.trim().length > 0 && !scanPick ? (
            <ul className="mt-2 space-y-1.5">
              {quickResults.map((p) => (
                <li key={p.variantId}>
                  <button
                    type="button"
                    onClick={() => {
                      manualAdd(p);
                      setQuery("");
                    }}
                    className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-[var(--pos-border)] bg-[var(--pos-surface-2)] px-3 py-2 text-left active:bg-[var(--pos-surface-hover)]"
                  >
                    <span className="min-w-0 truncate text-sm font-semibold">
                      {p.name}
                      {p.variantLabel ? <span className="text-[var(--pos-text-muted)]"> · {p.variantLabel}</span> : null}
                      <span className="ml-2 text-xs font-normal capitalize text-[var(--pos-text-faint)]">{p.category}</span>
                    </span>
                    <span className="shrink-0 text-sm font-bold text-[var(--pos-accent)]">{money(p.regularPriceMinor)}</span>
                  </button>
                </li>
              ))}
              {quickResults.length === 0 ? (
                <li className="px-2 py-3 text-center text-sm text-[var(--pos-text-faint)]">No products match — press Enter to try it as a barcode.</li>
              ) : null}
            </ul>
          ) : null}
          {/* AO-4 — the check as the mockup's clean table: PRODUCT /
              CATEGORY / PRICE / QTY steppers / TOTAL / remove, with the last
              scan wearing a JUST SCANNED tag. Tap the product cell to expand
              the row for Override/Undo (B24) — same machinery, table shape. */}
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
            {cart.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-1 px-2 py-12 text-center">
                <span className="text-3xl" aria-hidden>📦</span>
                <span className="text-sm font-semibold text-[var(--pos-text-muted)]">Scan a package barcode — items land here.</span>
                <span className="text-xs text-[var(--pos-text-faint)]">No clicks needed. Or search above, or open the menu below.</span>
              </div>
            ) : (
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-[var(--pos-text-faint)]">
                    <th className="sticky top-0 bg-[var(--pos-surface)] px-2 pb-2">Product</th>
                    <th className="sticky top-0 hidden bg-[var(--pos-surface)] px-2 pb-2 md:table-cell">Category</th>
                    <th className="sticky top-0 bg-[var(--pos-surface)] px-2 pb-2 text-right">Price</th>
                    <th className="sticky top-0 bg-[var(--pos-surface)] px-2 pb-2 text-center">Qty</th>
                    <th className="sticky top-0 bg-[var(--pos-surface)] px-2 pb-2 text-right">Total</th>
                    <th className="sticky top-0 bg-[var(--pos-surface)] px-1 pb-2" aria-label="Remove" />
                  </tr>
                </thead>
                <tbody>
                  {priced.lines.map((l, i) => {
                    const medLine = carded ? priced.med?.lines[i] : null;
                    const exempt = !!medLine && (medLine.salesExempt || medLine.exciseExempt);
                    // B24 — the raw engine line (pre-override, pre-medical) this
                    // line derives from; applyPriceOverrides and applyMedicalPricing
                    // both map 1:1 in order, so index i lines up exactly.
                    const engineLine = priced.engineLines[i];
                    const activeOverride = l.variantId ? overrides[l.variantId] : undefined;
                    const cartEntry = cart.find((e) => e.product.variantId === l.variantId);
                    const lineKey = `${l.productId}-${l.variantLabel ?? ""}`;
                    const open = expandedLine === lineKey;
                    const variantId = cartVariantId(cart, l.productId, l.variantLabel);
                    const justScanned = lastScannedId !== null && l.variantId === lastScannedId;
                    return (
                      <Fragment key={lineKey}>
                        <tr className={open ? "bg-[var(--pos-surface-hover)]" : ""}>
                          <td className="border-t border-[var(--pos-border)] px-2 py-2.5">
                            <button
                              type="button"
                              onClick={() => setExpandedLine(open ? null : lineKey)}
                              className="block w-full text-left"
                              aria-expanded={open}
                              title="Tap for line options (override, remove)."
                            >
                              <span className="font-semibold">
                                {l.productName}
                                {l.variantLabel ? <span className="text-[var(--pos-text-muted)]"> — {l.variantLabel}</span> : null}
                              </span>
                              {justScanned ? (
                                <span className="ml-2 rounded bg-[var(--pos-accent-soft)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--pos-accent)]">
                                  JUST SCANNED
                                </span>
                              ) : null}
                              {exempt ? (
                                <span className="ml-2 rounded bg-[var(--pos-info-soft)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--pos-info)]">
                                  MED · TAX OFF
                                </span>
                              ) : null}
                              {activeOverride ? (
                                <span className="ml-2 rounded bg-[var(--pos-warn-soft)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--pos-warn)]">
                                  OVERRIDE · {activeOverride.approvedByName}
                                </span>
                              ) : null}
                              {l.appliedLabel ? (
                                <span className="mt-0.5 block text-xs text-[var(--pos-accent)]">{l.appliedLabel}</span>
                              ) : null}
                              {activeOverride ? (
                                <span className="mt-0.5 block text-xs text-[var(--pos-warn)]">was {money(activeOverride.originalUnitPriceMinor)}</span>
                              ) : null}
                            </button>
                          </td>
                          <td className="hidden border-t border-[var(--pos-border)] px-2 py-2.5 text-xs capitalize text-[var(--pos-text-muted)] md:table-cell">
                            {l.category}
                          </td>
                          <td className="border-t border-[var(--pos-border)] px-2 py-2.5 text-right tabular-nums">{money(l.unitPriceMinor)}</td>
                          <td className="border-t border-[var(--pos-border)] px-2 py-2.5">
                            <span className="flex items-center justify-center gap-1.5">
                              <QtyButton label="−" onClick={() => setCart(setCartQuantity(cart, variantId, l.quantity - 1))} />
                              <span className="w-7 text-center font-bold tabular-nums">{l.quantity}</span>
                              <QtyButton
                                label="+"
                                onClick={() => {
                                  // SLICE 14 — the owner's second report: the
                                  // + button added without limit. It now
                                  // refuses and says why, rather than looking
                                  // broken.
                                  const line = cart.find((e) => e.product.variantId === variantId);
                                  if (line && !canAddOne(l.quantity, line.product.unitsLeft, stockOverride)) {
                                    const label = line.product.variantLabel
                                      ? `${line.product.name} (${line.product.variantLabel})`
                                      : line.product.name;
                                    // SLICE 15 FIX A — same escape hatch as the
                                    // menu grid: the refusal carries the override.
                                    setStockOverrideOffer(stockRefusalMessage(label, line.product.unitsLeft));
                                    return;
                                  }
                                  setCart(setCartQuantity(cart, variantId, l.quantity + 1, stockOverride));
                                }}
                              />
                            </span>
                          </td>
                          <td className="border-t border-[var(--pos-border)] px-2 py-2.5 text-right font-bold tabular-nums">
                            {money(l.unitPriceMinor * l.quantity)}
                          </td>
                          <td className="border-t border-[var(--pos-border)] px-1 py-2.5 text-center">
                            <button
                              type="button"
                              onClick={() => {
                                setCart(setCartQuantity(cart, variantId, 0));
                                setExpandedLine(null);
                              }}
                              aria-label={`Remove ${l.productName}`}
                              title="Remove this line from the check."
                              className="pos-tile min-h-9 min-w-9 rounded-lg border border-[var(--pos-border)] px-2 py-1 text-sm font-bold text-[var(--pos-danger)]"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                        {open && onApprove && cartEntry && engineLine ? (
                          <tr>
                            <td colSpan={6} className="bg-[var(--pos-surface-hover)] px-2 py-2">
                              {activeOverride ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const next = { ...overrides };
                                    delete next[l.variantId ?? ""];
                                    setOverrides(next);
                                  }}
                                  className="pos-tile min-h-11 rounded-lg border border-[var(--pos-border)] bg-[var(--pos-surface)] px-4 py-2 text-sm font-semibold text-[var(--pos-warn)]"
                                  title="Remove the manager override — the line returns to the engine price."
                                >
                                  Undo override
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setOverrideTarget({ product: cartEntry.product, engineLine })}
                                  className="pos-tile min-h-11 rounded-lg border border-[var(--pos-border)] bg-[var(--pos-surface)] px-4 py-2 text-sm font-semibold text-[var(--pos-text-muted)]"
                                  title="Manager price override (markdown only; PIN + reason required)."
                                >
                                  Override price…
                                </button>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {/* AM-A — browse is on demand: menu grid, favorites, and the
              keypad open in an overlay so the item area stays LARGE. */}
          <div className="mt-3 flex gap-2 border-t border-[var(--pos-border)] pt-3">
            <button
              type="button"
              onClick={() => {
                setBrowseTab("menu");
                setBrowseOpen(true);
              }}
              className="pos-tile min-h-11 flex-1 rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-4 py-2 text-sm font-semibold"
            >
              ☰ Browse menu
            </button>
            <button
              type="button"
              onClick={() => {
                setBrowseTab("favorites");
                setBrowseOpen(true);
              }}
              className="pos-tile min-h-11 flex-1 rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-4 py-2 text-sm font-semibold"
            >
              ★ Favorites{favorites.length > 0 ? ` (${favoriteTiles.length})` : ""}
            </button>
            <button
              type="button"
              onClick={() => {
                setBrowseTab("keypad");
                setBrowseOpen(true);
              }}
              className="pos-tile min-h-11 flex-1 rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-4 py-2 text-sm font-semibold"
            >
              ⌨ Keypad
            </button>
          </div>
        </section>

        {/* AO-4 — the Cart Summary rail (owner-approved register.html
            mockup): legal-limit meter first, itemized lines, loyalty box
            with earn preview, totals, then the green Tender Cash button
            with quick-tender denomination chips. Same machinery as before
            (B22 limits, AM-B loyalty, B24 overrides) — mockup shape. */}
        <section className="flex flex-col rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface)] p-4 lg:min-h-0">
          <h2 className="flex items-baseline justify-between text-base font-bold">
            Cart Summary
            <span className="text-xs font-normal text-[var(--pos-text-faint)]">
              {cart.length === 0 ? "no items yet" : `${cart.reduce((s, e) => s + e.quantity, 0)} item(s)`}
            </span>
          </h2>
          <div className="min-h-0 flex-1 overflow-y-auto">
          {highThcViolations.length > 0 ? (
            <p className="mt-3 rounded-lg border border-[var(--pos-danger-border)] bg-[var(--pos-danger-soft)] px-3 py-2 text-xs font-semibold text-[var(--pos-danger)]">
              {highThcViolations.map((n) => `"${n}"`).join(", ")}{" "}
              {highThcViolations.length === 1 ? "is a DOH High-THC product" : "are DOH High-THC products"} and may
              ONLY be sold to a patient with a valid recognition card (chapter 246-70 WAC). Remove{" "}
              {highThcViolations.length === 1 ? "it" : "them"}, or restart the sale on the medical path. No override
              exists.
            </p>
          ) : null}

          {/* SLICE 14 — stock block + the owner's requested escape hatch.
              Shown in the same visual family as the limit and High-THC
              notices so every blocking rule reads as one language. Unlike
              High-THC (statutory, no override exists) this one CAN be lifted,
              because the count is a cached snapshot and the shelf is the
              truth. The last-refreshed line is what lets the budtender judge
              how much to trust the number (owner decision Q3). */}
          {stockBlocks.length > 0 ? (
            <div className="mt-3 rounded-lg border border-[var(--pos-danger-border)] bg-[var(--pos-danger-soft)] px-3 py-2">
              <p className="text-xs font-semibold text-[var(--pos-danger)]">{stockBlocks.join(" ")}</p>
              <p className="mt-1 text-[11px] text-[var(--pos-text-muted)]">
                Stock counts come from the menu last refreshed {menuAgeLabel}. If the product is physically on the
                shelf, sell it anyway and let the count catch up.
              </p>
              <button
                type="button"
                onClick={() => {
                  setStockOverride(true);
                  setScanBlockNotice(null);
                }}
                className="pos-tile mt-2 min-h-11 rounded-lg border border-[var(--pos-danger-border)] bg-[var(--pos-surface)] px-4 py-2 text-xs font-bold text-[var(--pos-danger)]"
              >
                Sell anyway — the unit is on the shelf
              </button>
            </div>
          ) : null}

          {stockOverride ? (
            <p className="mt-3 rounded-lg border border-[var(--pos-warn-border)] bg-[var(--pos-warn-soft)] px-3 py-2 text-[11px] font-semibold text-[var(--pos-warn)]">
              Stock limits are OFF for this sale — a staff member confirmed the product is on the shelf. The count
              will be reconciled at the next cycle count. Enforcement returns automatically for the next customer.
            </p>
          ) : null}

          {priced.problems.length > 0 ? (
            <p className="mt-3 rounded-lg border border-[var(--pos-danger-border)] bg-[var(--pos-danger-soft)] px-3 py-2 text-xs text-[var(--pos-danger)]">{priced.problems.join(" ")}</p>
          ) : null}

          {/* WAC 314-55-095 limit meter — brand green while safe, amber near
              the line, red over it. AO-4: mockup's LEGAL LIMIT header + OK
              badge so "are we fine?" reads at a glance. */}
          <div className="mt-3 rounded-xl border border-[var(--pos-border)] bg-[var(--pos-surface-2)] px-3 py-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--pos-text-faint)]">
                Legal limit (WAC 314-55-095)
              </span>
              {cart.length > 0 ? (
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    limits.blocked
                      ? "bg-[var(--pos-danger-soft)] text-[var(--pos-danger)]"
                      : limits.softWarning
                        ? "bg-[var(--pos-warn-soft)] text-[var(--pos-warn)]"
                        : "bg-[var(--pos-accent-soft)] text-[var(--pos-accent)]"
                  }`}
                >
                  {limits.blocked ? "OVER" : limits.softWarning ? "NEAR" : "OK"}
                </span>
              ) : null}
            </div>
            <div className="mt-1.5 space-y-1">
            {limits.evaluation.buckets
              .filter((b) => b.usedGrams > 0)
              .map((b) => (
                <div key={b.bucket} className="text-xs">
                  <div className="flex justify-between text-[var(--pos-text-muted)]">
                    <span>{b.label}</span>
                    <span className={b.exceeded ? "font-bold text-[var(--pos-danger)]" : ""}>
                      {b.usedGrams}g / {b.maxGrams}g
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 w-full rounded bg-[var(--pos-surface-hover)]">
                    <div
                      className={`h-1.5 rounded ${b.exceeded ? "bg-[var(--pos-danger)]" : b.ratio > 0.8 ? "bg-[var(--pos-warn-dot)]" : "bg-[var(--pos-accent)]"}`}
                      style={{ width: `${Math.min(100, Math.round(b.ratio * 100))}%` }}
                    />
                  </div>
                </div>
              ))}
            {cart.length > 0 && limits.evaluation.buckets.every((b) => b.usedGrams === 0) ? (
              <p className="text-xs text-[var(--pos-text-faint)]">No cannabis items yet — nothing counts toward the limit.</p>
            ) : null}
            {cart.length === 0 ? (
              <p className="text-xs text-[var(--pos-text-faint)]">The meter fills as cannabis items land in the cart.</p>
            ) : null}
            </div>
          </div>
          {limits.blocked ? (
            <p className="mt-2 rounded-lg border border-[var(--pos-danger-border)] bg-[var(--pos-danger-soft)] px-3 py-2 text-xs font-semibold text-[var(--pos-danger)]">
              Over the WAC 314-55-095 single-transaction limit — remove items. {limits.evaluation.reasons.join(" ")}
            </p>
          ) : limits.softWarning ? (
            <p className="mt-2 rounded-lg border border-[var(--pos-warn-border)] bg-[var(--pos-warn-soft)] px-3 py-2 text-xs font-semibold text-[var(--pos-warn)]">
              Over the configured limit (soft warning). {limits.evaluation.reasons.join(" ")}
            </p>
          ) : null}

          {/* B32 — cart-level stock awareness. Warnings only, NEVER blocks:
              the cached menu can lag the shelf; the B19 decrement + server
              completion gate are the authority at sync. */}
          {stockWarnings.length > 0 ? (
            <ul className="mt-2 space-y-1 rounded-lg border border-[var(--pos-warn-border)] bg-[var(--pos-warn-soft)] px-3 py-2 text-xs text-[var(--pos-warn)]">
              {stockWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}

          {/* Saved-cart smart release — the unit this cart needs is parked in
              the SAVED sale (the Cultivera pain, solved): name the hold, what
              it is sitting on, and offer the one-tap release right here. The
              sale is never blocked either way — releasing just stops the two
              carts from silently competing for the same physical unit. */}
          {heldConflicts.length > 0 && heldSale ? (
            <div className="mt-2 rounded-lg border border-[var(--pos-info-border)] bg-[var(--pos-info-soft)] px-3 py-2 text-xs text-[var(--pos-info)]">
              <p className="font-semibold">
                A saved sale is holding stock this cart needs — saved by {heldSale.heldByName}{" "}
                {ageLabel(heldSale.heldAtIso, new Date())}
                {heldSummary ? ` (${heldSummary})` : ""}.
              </p>
              <ul className="mt-1 space-y-0.5">
                {heldConflicts.map((c) => (
                  <li key={c.variantId}>{c.message}</li>
                ))}
              </ul>
              {onReleaseHold ? (
                <button
                  type="button"
                  onClick={onReleaseHold}
                  className="pos-tile mt-2 rounded-lg bg-[var(--pos-info-solid)] px-3 py-1.5 text-xs font-bold text-white"
                >
                  Delete the saved sale — free its items for this customer
                </button>
              ) : null}
            </div>
          ) : null}

          {/* AO-4 — the mockup's itemized ITEMS list: every line + its money
              at a glance, so the rail reads like the receipt will. */}
          {priced.lines.length > 0 ? (
            <div className="mt-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--pos-text-faint)]">
                Items ({cart.reduce((s, e) => s + e.quantity, 0)})
              </p>
              <ul className="mt-1 space-y-0.5">
                {priced.lines.map((l) => (
                  <li key={`${l.productId}-${l.variantLabel ?? ""}`} className="flex justify-between gap-2 text-xs text-[var(--pos-text-muted)]">
                    <span className="min-w-0 truncate">
                      {l.quantity > 1 ? `${l.quantity}× ` : ""}
                      {l.productName}
                      {l.variantLabel ? ` — ${l.variantLabel}` : ""}
                    </span>
                    <span className="shrink-0 tabular-nums">{money(l.unitPriceMinor * l.quantity)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          </div>
          {/* B37 — sticky totals: the money and the tender button stay pinned
              to the panel's bottom edge while a long check scrolls behind. */}
          <div className="sticky bottom-0 -mx-4 -mb-4 mt-4 rounded-b-2xl border-t border-[var(--pos-border-strong)] bg-[var(--pos-surface)] px-4 pb-4 pt-3 text-sm">
            {/* AM-B — loyalty discount buttons: redeem the attached member's
                points, or apply a code the customer brought. ONLINE-ONLY;
                the server sizes the value to what the cart can legally
                absorb. One application per sale (no stacking — S-a policy). */}
            {/* AO-4 — the mockup's loyalty box: the member's balance + what
                THIS sale will earn (same floor(pre-tax $ × rate) estimate the
                receipt prints; authoritative accrual runs server-side at
                completion), with the redeem/code buttons underneath. */}
            {member && bundle.loyalty ? (
              <div className="mb-2 rounded-xl border border-[var(--pos-accent-border)] bg-[var(--pos-accent-soft)] px-3 py-2 text-xs">
                <p className="font-semibold text-[var(--pos-accent)]">
                  💚 {member.label} has {member.points.toLocaleString("en-US")} points
                  {bundle.loyalty.pointValueMinor ? ` (= ${money(member.points * bundle.loyalty.pointValueMinor)})` : ""}
                </p>
                {cart.length > 0 ? (
                  <p className="mt-0.5 text-[var(--pos-text-muted)]">
                    This sale earns ~
                    {Math.floor((railTotals.subtotalMinorUnits / 100) * bundle.loyalty.pointsPerDollar).toLocaleString("en-US")}{" "}
                    points.
                  </p>
                ) : null}
              </div>
            ) : null}
            {onLoyalty ? (
              <LoyaltyRedeemPanel
                bundle={bundle}
                member={member}
                appliedLoyalty={appliedLoyalty}
                setAppliedLoyalty={(a) => {
                  // SLICE 28 — no stacking: a loyalty redemption and a special
                  // discount share the "reduce the unit price" lane.
                  if (a) setAppliedSpecial(null);
                  setAppliedLoyalty(a);
                }}
                releaseLoyalty={releaseLoyalty}
                loyaltyFingerprint={loyaltyFingerprint}
                pricedLines={priced.lines}
                onLoyalty={onLoyalty}
                cartEmpty={cart.length === 0}
              />
            ) : null}
            {/* SLICE 28 — special discounts (employee / industry / veteran).
                Programs come from the bundle (owner-set rates); each collects
                its facts before applying, and applying one drops any loyalty
                redemption (no stacking). */}
            <SpecialDiscountPanel
              bundle={bundle}
              appliedSpecial={appliedSpecial}
              setAppliedSpecial={(a) => {
                if (a && appliedLoyalty) {
                  releaseLoyalty(appliedLoyalty);
                  setAppliedLoyalty(null);
                }
                setAppliedSpecial(a);
              }}
              loyaltyFingerprint={loyaltyFingerprint}
              pricedLines={priced.lines}
              onWitness={onWitness}
              employeeId={employeeId}
              registerId={registerId}
              employeeName={employeeName}
              cartEmpty={cart.length === 0}
            />
            <Row label="Subtotal (pre-tax)" value={money(railTotals.subtotalMinorUnits)} />
            {/* Promo savings only — the loyalty reduction gets its OWN row
                below, so the two never double-count in the display. */}
            {priced.totals.savingsMinorUnits > 0 ? (
              <Row label="Discount" value={`−${money(priced.totals.savingsMinorUnits)}`} accent />
            ) : null}
            {carded && (priced.med?.medicalSavingsMinor ?? 0) > 0 ? (
              <Row
                label="Medical savings (tax off)"
                value={`−${money(priced.med?.medicalSavingsMinor ?? 0)}`}
                accent
              />
            ) : null}
            {appliedLoyalty && loyaltyView ? (
              <Row label={`Loyalty ${appliedLoyalty.code}`} value={`−${money(loyaltyView.appliedMinor)}`} accent />
            ) : null}
            {appliedSpecial && specialView ? (
              <Row
                label={`${SPECIAL_DISCOUNT_LABELS[appliedSpecial.kind]} (${formatBps(appliedSpecial.percentBps)})`}
                value={`−${money(specialView.appliedMinor)}`}
                accent
              />
            ) : null}
            <Row label="Tax (excise + sales)" value={money(railTotals.estimatedTaxMinorUnits)} />
            <div className="mt-1 flex justify-between text-xl font-bold">
              <span>TOTAL</span>
              <span className="text-[var(--pos-accent)]">{money(railTotals.totalMinorUnits)}</span>
            </div>

            {/* AO-4 — the mockup's big green tender button, TOTAL on its
                face, quick-tender denomination chips underneath: one tap
                records the cash handed over and opens the tender screen
                with change already computed. Chips run off the SAME B31
                smart suggestions + B33 rounded due as the tender screen. */}
            <button
              type="button"
              disabled={!canTender}
              onClick={() => onTender()}
              className="pos-tile mt-3 w-full rounded-2xl bg-[var(--pos-accent)] px-6 py-4 text-lg font-bold text-[var(--pos-accent-ink)] disabled:opacity-40"
            >
              Tender Cash{canTender ? ` — ${money(quickTender.dueMinor)}` : ""}
            </button>
            {canTender && quickTender.chips.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {quickTender.chips.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    onClick={() => onTender(c.amountMinor)}
                    title={`Customer hands ${c.label === "Exact" ? "exact change" : money(c.amountMinor)} — opens the tender screen with change computed.`}
                    className="pos-tile min-h-11 flex-1 rounded-xl border border-[var(--pos-accent-border)] bg-[var(--pos-accent-soft)] px-3 py-2 text-sm font-bold text-[var(--pos-accent)]"
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      </div>

      {/* AM-A — the browse overlay: the full B36/B39/B40 surface (menu grid
          with search + category chips, favorites, keypad) on demand. A
          successful scan closes it so the cashier sees the item land. */}
      {browseOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="flex h-[92vh] w-full max-w-5xl flex-col">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Browse products</h2>
              <button
                type="button"
                onClick={() => setBrowseOpen(false)}
                className="pos-tile min-h-11 rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-5 py-2 text-sm font-semibold text-[var(--pos-text)]"
              >
                Done
              </button>
            </div>
        {/* B36 — product browser: prominent scan/search bar, category filter
            chips (Toast groups), then a Square/Shopify-style tile grid. */}
        <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface)] p-4">
          {/* B39 — browse surface tabs: the item grid (default) and the
              quick-amount keypad (Square's Keypad, non-cannabis only). */}
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              onClick={() => setBrowseTab("menu")}
              className={`min-h-11 rounded-full px-5 py-2 text-sm font-semibold ${
                browseTab === "menu"
                  ? "bg-[var(--pos-accent)] text-[var(--pos-accent-ink)]"
                  : "border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] text-[var(--pos-text-muted)]"
              }`}
            >
              Menu
            </button>
            <button
              type="button"
              onClick={() => setBrowseTab("favorites")}
              className={`min-h-11 rounded-full px-5 py-2 text-sm font-semibold ${
                browseTab === "favorites"
                  ? "bg-[var(--pos-accent)] text-[var(--pos-accent-ink)]"
                  : "border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] text-[var(--pos-text-muted)]"
              }`}
            >
              ★ Favorites{favorites.length > 0 ? ` (${favoriteTiles.length})` : ""}
            </button>
            <button
              type="button"
              onClick={() => setBrowseTab("keypad")}
              className={`min-h-11 rounded-full px-5 py-2 text-sm font-semibold ${
                browseTab === "keypad"
                  ? "bg-[var(--pos-accent)] text-[var(--pos-accent-ink)]"
                  : "border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] text-[var(--pos-text-muted)]"
              }`}
            >
              Keypad
            </button>
            {scanRequiredOn ? (
              <span className="ml-auto flex items-center gap-2">
                <span
                  className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
                    scanUnlocked
                      ? "border-[var(--pos-warn-border)] bg-[var(--pos-warn-soft)] text-[var(--pos-warn)]"
                      : "border-[var(--pos-accent-border)] bg-[var(--pos-accent-soft)] text-[var(--pos-accent)]"
                  }`}
                >
                  {scanUnlocked ? "Scan requirement lifted (this sale)" : "Scan required"}
                </span>
                {!scanUnlocked && onApprove ? (
                  <button
                    type="button"
                    onClick={() => setScanUnlockOpen(true)}
                    className="pos-tile rounded-full border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--pos-text-muted)]"
                  >
                    Manager unlock
                  </button>
                ) : null}
              </span>
            ) : null}
          </div>
          {scanBlockNotice ? (
            <div className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-[var(--pos-warn-border)] bg-[var(--pos-warn-soft)] px-3 py-2">
              <p className="text-xs font-semibold text-[var(--pos-warn)]">{scanBlockNotice}</p>
              <button
                type="button"
                onClick={() => setScanBlockNotice(null)}
                aria-label="Dismiss"
                className="text-xs font-bold text-[var(--pos-warn-muted)]"
              >
                ✕
              </button>
            </div>
          ) : null}
          {/* SLICE 15 FIX A — the override travels with the refusal, so the
              menu-grid path offers it here too (this is the second of the two
              places the register can refuse an add). */}
          <StockOverrideOffer
            offer={stockOverrideOffer}
            menuAgeLabel={menuAgeLabel}
            onOverride={() => {
              setStockOverride(true);
              setStockOverrideOffer(null);
              setScanBlockNotice(null);
            }}
            onDismiss={() => setStockOverrideOffer(null)}
          />
          {browseTab === "keypad" ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <KeypadPanel onAdd={(p) => manualAdd(p)} />
            </div>
          ) : browseTab === "favorites" ? (
            <div className="flex min-h-0 flex-1 flex-col">
              {/* B40 — Square-style Favorites page: this register's pinned
                  best-sellers, one tap to ring. Pins live per device. */}
              <ul className="grid min-h-0 flex-1 grid-cols-2 content-start gap-2.5 overflow-y-auto xl:grid-cols-3 2xl:grid-cols-4">
                {favoriteTiles.map((p) => (
                  <li key={p.variantId}>
                    <ProductTile
                      product={p}
                      pinned
                      onAdd={() => manualAdd(p)}
                      onTogglePin={() => togglePin(p.variantId)}
                      onInfo={() => setInfoProduct(p)}
                    />
                  </li>
                ))}
                {favoriteTiles.length === 0 ? (
                  <li className="col-span-full px-2 py-8 text-center text-sm text-[var(--pos-text-faint)]">
                    No favorites pinned on this register yet. Tap the ☆ on any Menu tile to pin your
                    best-sellers here (up to {MAX_FAVORITES}).
                  </li>
                ) : null}
              </ul>
              {favorites.length >= MAX_FAVORITES ? (
                <p className="mt-2 text-center text-xs text-[var(--pos-text-faint)]">
                  Favorites page is full ({MAX_FAVORITES}) — unpin a tile to add another.
                </p>
              ) : null}
            </div>
          ) : (
          <>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg" aria-hidden>
              🔍
            </span>
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
              className="w-full rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] py-3 pl-10 pr-3 text-base focus:border-[var(--pos-accent-border)] focus:outline-none"
            />
          </div>
          {chips.length > 0 ? (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {/* AL-A — 44px-min touch targets (Apple HIG 44pt / WCAG 2.5.5):
                  chips were px-3 py-1.5 text-xs, too small for confident
                  finger taps during an 8-hour shift. */}
              <button
                type="button"
                onClick={() => setCategory(null)}
                className={`min-h-11 shrink-0 rounded-full border px-4 py-2 text-sm font-bold ${
                  category === null
                    ? "border-[var(--pos-accent-border)] bg-[var(--pos-accent-soft)] text-[var(--pos-accent)]"
                    : "border-[var(--pos-border)] bg-[var(--pos-surface-2)] text-[var(--pos-text-muted)]"
                }`}
              >
                All
              </button>
              {chips.map((c) => {
                const active = category !== null && c.category.toLowerCase() === category.toLowerCase();
                const style = categoryStyle(c.category);
                return (
                  <button
                    key={c.category.toLowerCase()}
                    type="button"
                    onClick={() => setCategory(active ? null : c.category)}
                    className={`min-h-11 shrink-0 rounded-full border px-4 py-2 text-sm font-bold capitalize ${
                      active ? `${style.chip} bg-[var(--pos-surface-hover)]` : "border-[var(--pos-border)] bg-[var(--pos-surface-2)] text-[var(--pos-text-muted)]"
                    }`}
                  >
                    <span className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${style.dot}`} aria-hidden />
                    {c.category}
                    <span className="ml-1 font-normal opacity-60">{c.count}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {/* SLICE 18D — the two specially-limited buckets, in their own row so
              a classification chip is never stranded inside the category row's
              `chips.length > 0` gate. Rendered only when the bundle actually
              holds qualifying stock. */}
          {classificationChips.length > 0 ? (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {classificationChips.map((chip) => {
                const active = activeClassification === chip.kind;
                return (
                  <button
                    key={chip.kind}
                    type="button"
                    title={chip.title}
                    aria-pressed={active}
                    onClick={() => setClassification(active ? null : chip.kind)}
                    className={`min-h-11 shrink-0 rounded-full border px-4 py-2 text-sm font-bold ${
                      active
                        ? "border-[var(--pos-info-border)] bg-[var(--pos-info-soft)] text-[var(--pos-info)]"
                        : "border-[var(--pos-border)] bg-[var(--pos-surface-2)] text-[var(--pos-text-muted)]"
                    }`}
                  >
                    {chip.label}
                    <span className="ml-1 font-normal opacity-60">{chip.count}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {scanFlash ? (
            <p className="mt-2 rounded-lg border border-[var(--pos-accent-border)] bg-[var(--pos-accent-soft)] px-3 py-2 text-xs font-semibold text-[var(--pos-accent)]">
              {scanFlash} — added to cart
            </p>
          ) : null}
          {scanPick ? (
            <div className="mt-2 rounded-xl border border-[var(--pos-info-border)] bg-[var(--pos-info-soft)] p-3">
              <p className="text-xs font-semibold text-[var(--pos-info)]">
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
                      setLastScannedId(p.variantId);
                      setScanPick(null);
                    }}
                    className="rounded-full bg-[var(--pos-info-solid)] px-3 py-1.5 text-xs font-bold text-white"
                  >
                    {p.variantLabel ?? "each"} · {money(p.regularPriceMinor)}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setScanPick(null)}
                  className="pos-tile rounded-full border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--pos-text)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          <ul className="mt-3 grid min-h-0 flex-1 grid-cols-2 content-start gap-2.5 overflow-y-auto xl:grid-cols-3 2xl:grid-cols-4">
            {results.map((p) => (
              <li key={p.variantId}>
                <ProductTile
                  product={p}
                  pinned={favorites.includes(p.variantId)}
                  onAdd={() => manualAdd(p)}
                  onTogglePin={() => togglePin(p.variantId)}
                  onInfo={() => setInfoProduct(p)}
                />
              </li>
            ))}
            {results.length === 0 ? (
              <li className="col-span-full px-2 py-6 text-center text-sm text-[var(--pos-text-faint)]">No products match.</li>
            ) : null}
          </ul>
          </>
          )}
        </section>

          </div>
        </div>
      ) : null}

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

      {scanUnlockOpen && onApprove ? (
        <ScanUnlockModal
          onApprove={onApprove}
          onClose={() => setScanUnlockOpen(false)}
          onUnlocked={() => {
            setScanUnlocked(true);
            setScanBlockNotice(null);
            setScanUnlockOpen(false);
          }}
        />
      ) : null}

      {infoProduct ? (
        <ProductInfoModal
          product={infoProduct}
          onProductImage={onProductImage}
          onStockFlag={onStockFlag}
          onAdd={() => {
            manualAdd(infoProduct);
            setInfoProduct(null);
          }}
          onClose={() => setInfoProduct(null)}
        />
      ) : null}
    </main>
  );
}

/**
 * POS B42 — product info on demand (Cova). Potency, strain type, terpenes
 * and a trimmed description come from the CACHED bundle, so the card works
 * fully offline; the single photo resolves ONLINE when the card opens (the
 * grid stays text-first by owner decision — no per-product images ride the
 * device cache). Sensory/descriptive facts only — no effects or medical
 * claims (website posture, WAC 314-55-155).
 */
function ProductInfoModal({
  product,
  onProductImage,
  onStockFlag,
  onAdd,
  onClose,
}: {
  product: PosMenuProduct;
  onProductImage?: (productId: string) => Promise<{ url: string; isFallback: boolean } | null>;
  /** B43 — flag this item out of stock (undefined = affordance hidden). */
  onStockFlag?: (productId: string, reason: StockFlagReason) => Promise<{ ok: true } | { ok: false; error: string }>;
  onAdd: () => void;
  onClose: () => void;
}) {
  const info = useMemo(() => buildProductInfo(product), [product]);
  const [image, setImage] = useState<{ url: string; isFallback: boolean } | null>(null);
  const [imageState, setImageState] = useState<"loading" | "done">(onProductImage ? "loading" : "done");
  // B43 — the two-tap flag flow: closed → picking a reason → posting.
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagBusy, setFlagBusy] = useState<StockFlagReason | null>(null);
  const [flagError, setFlagError] = useState<string | null>(null);

  const flag = async (reason: StockFlagReason) => {
    if (!onStockFlag || flagBusy) return;
    setFlagBusy(reason);
    setFlagError(null);
    try {
      const res = await onStockFlag(product.productId, reason);
      if (!res.ok) {
        setFlagError(res.error);
        return;
      }
      onClose(); // The shell already removed the item from the cached bundle.
    } catch {
      setFlagError("Could not reach the server — try again.");
    } finally {
      setFlagBusy(null);
    }
  };

  useEffect(() => {
    // ONLINE-ONLY, best-effort photo fetch when the card opens. `active`
    // guards against a late response landing on a different product's card.
    if (!onProductImage) return;
    let active = true;
    onProductImage(product.productId)
      .then((img) => {
        if (!active) return;
        setImage(img);
        setImageState("done");
      })
      .catch(() => {
        if (active) setImageState("done");
      });
    return () => {
      active = false;
    };
  }, [onProductImage, product.productId]);

  const style = categoryStyle(info.category);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface)] p-6 text-[var(--pos-text)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-[var(--pos-text-faint)]">
              <span className={`h-2 w-2 rounded-full ${style.dot}`} aria-hidden />
              <span className="capitalize">{info.category}</span>
            </p>
            <h2 className="mt-1 text-lg font-semibold leading-snug">
              {info.name}
              {info.variantLabel ? <span className="text-[var(--pos-text-muted)]"> · {info.variantLabel}</span> : null}
            </h2>
            {info.brand ? <p className="text-xs text-[var(--pos-text-faint)]">{info.brand}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="pos-tile shrink-0 rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-1.5 text-sm">
            Close
          </button>
        </div>

        {imageState === "loading" ? (
          <div className="mt-4 h-40 animate-pulse rounded-xl border border-[var(--pos-border)] bg-[var(--pos-surface-2)]" />
        ) : image ? (
          <div className="mt-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- one-off,
                online-only card photo; next/image adds nothing on the register PWA. */}
            <img
              src={image.url}
              alt={info.name}
              className="max-h-52 w-full rounded-xl border border-[var(--pos-border)] object-contain"
            />
            {image.isFallback ? (
              <p className="mt-1 text-[10px] text-[var(--pos-text-faint)]">Representative photo — not this exact package.</p>
            ) : null}
          </div>
        ) : null}

        {info.rows.length > 0 ? (
          <dl className="mt-4 grid grid-cols-3 gap-2">
            {info.rows.map((r) => (
              <div key={r.label} className="rounded-xl border border-[var(--pos-border)] bg-[var(--pos-surface-2)] px-3 py-2 text-center">
                <dt className="text-[10px] font-bold uppercase tracking-wide text-[var(--pos-text-faint)]">{r.label}</dt>
                <dd className="mt-0.5 text-sm font-semibold">{r.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {info.terpenes.length > 0 ? (
          <div className="mt-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--pos-text-faint)]">Dominant terpenes</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {info.terpenes.map((t) => (
                <span key={t} className="rounded-full border border-[var(--pos-border)] bg-[var(--pos-surface-2)] px-2.5 py-1 text-xs capitalize text-[var(--pos-text-muted)]">
                  {t}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {info.description ? (
          <p className="mt-3 text-sm leading-relaxed text-[var(--pos-text-muted)]">{info.description}</p>
        ) : null}

        <div className="mt-5 flex items-center justify-between gap-3">
          <span className="text-lg font-bold text-[var(--pos-accent)]">{money(info.priceMinor)}</span>
          <button
            type="button"
            onClick={onAdd}
            className="pos-tile rounded-xl bg-[var(--pos-accent)] px-6 py-3 text-sm font-bold text-[var(--pos-accent-ink)]"
          >
            Add to check
          </button>
        </div>

        {/* B43 — Toast-style "86 it": the shelf is empty but the menu still
            shows the item. One-way (bringing it back is a back-office
            action), online-only, audited server-side. */}
        {onStockFlag && canFlagOutOfStock(product) ? (
          <div className="mt-4 border-t border-[var(--pos-border)] pt-3">
            {!flagOpen ? (
              <button
                type="button"
                onClick={() => setFlagOpen(true)}
                className="text-xs font-semibold text-[var(--pos-text-faint)] underline underline-offset-2"
              >
                Shelf is empty? Mark out of stock…
              </button>
            ) : (
              <div>
                <p className="text-xs font-semibold text-[var(--pos-warn)]">
                  Remove {info.name} from every register and the website? Pick why — a manager
                  brings it back through the back office when stock returns.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {STOCK_FLAG_REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      disabled={flagBusy !== null}
                      onClick={() => void flag(r)}
                      className="pos-tile rounded-lg border border-[var(--pos-warn-border)] bg-[var(--pos-warn-soft)] px-3 py-2 text-xs font-semibold capitalize text-[var(--pos-warn)] disabled:opacity-40"
                    >
                      {flagBusy === r ? "Flagging…" : r}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={flagBusy !== null}
                    onClick={() => {
                      setFlagOpen(false);
                      setFlagError(null);
                    }}
                    className="pos-tile rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-2 text-xs font-semibold text-[var(--pos-text-muted)]"
                  >
                    Cancel
                  </button>
                </div>
                {flagError ? (
                  <p className="mt-2 rounded-lg border border-[var(--pos-danger-border)] bg-[var(--pos-danger-soft)] px-3 py-2 text-xs font-semibold text-[var(--pos-danger)]">{flagError}</p>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * POS B41 — manager unlock for scan-required mode. A manager or lead lifts
 * the scan requirement for THE CURRENT SALE ONLY (damaged label, scanner
 * down) with their PIN — verified server-side by /api/pos/approve (same
 * scrypt + throttle + role gate as the B24 price override), so this is
 * ONLINE-ONLY. The register locks after every sale, which unmounts the sale
 * screen — the unlock can never leak into the next customer.
 */
function ScanUnlockModal({
  onApprove,
  onClose,
  onUnlocked,
}: {
  onApprove: (pin: string) => Promise<{ ok: true; approver: { id: string; fullName: string } } | { ok: false; error: string }>;
  onClose: () => void;
  onUnlocked: () => void;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlock = async () => {
    if (busy || pin.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      const res = await onApprove(pin);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onUnlocked();
    } catch {
      setError("Could not reach the server — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface)] p-6 text-[var(--pos-text)]">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Lift scan requirement</h2>
          <button type="button" onClick={onClose} className="pos-tile rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-1.5 text-sm">
            Cancel
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--pos-text-muted)]">
          Cannabis items can then be added by tapping tiles for THIS SALE ONLY (damaged label,
          scanner down). The register re-locks after the sale, so the next customer starts with
          scanning required again.
        </p>

        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-[var(--pos-text-muted)]">
          Manager / lead PIN
        </label>
        <input
          className="mt-1 w-full rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-2.5 text-center font-mono text-lg tracking-[0.5em]"
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

        {error ? (
          <p className="mt-3 rounded-lg border border-[var(--pos-danger-border)] bg-[var(--pos-danger-soft)] px-3 py-2 text-xs font-semibold text-[var(--pos-danger)]">{error}</p>
        ) : null}

        <button
          type="button"
          disabled={busy || pin.length < 4}
          onClick={unlock}
          className="pos-tile mt-4 w-full rounded-xl bg-[var(--pos-warn-solid)] px-4 py-3 text-sm font-bold text-white disabled:opacity-40"
        >
          {busy ? "Verifying…" : "Lift for this sale"}
        </button>
      </div>
    </div>
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
      <div className="w-full max-w-md rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface)] p-6 text-[var(--pos-text)]">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Price override</h2>
          <button type="button" onClick={onClose} className="pos-tile rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-1.5 text-sm">
            Cancel
          </button>
        </div>
        <p className="mt-2 text-sm">
          {engineLine.productName} — currently {money(engineLine.unitPriceMinor)} each
          {engineLine.appliedLabel ? ` (${engineLine.appliedLabel})` : ""}.
        </p>
        <p className="mt-1 text-xs text-[var(--pos-text-muted)]">
          Markdowns only — raise prices in the back office menu. Floor for this item:{" "}
          <span className="font-semibold text-[var(--pos-text)]">{money(Math.max(1, floorMinor))}</span> (statutory minimum /
          acquisition cost). A manager or lead approves with their PIN; the override is audited at sync.
        </p>

        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-[var(--pos-text-muted)]">
          New price per unit
        </label>
        <input
          className="mt-1 w-full rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-2.5 text-lg font-semibold"
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
                preset === p ? "bg-[var(--pos-warn-solid)] text-white" : "border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] text-[var(--pos-text-muted)]"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <input
          className="mt-3 w-full rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-2.5 text-sm"
          placeholder="Or type another reason (3–500 characters)…"
          value={custom}
          maxLength={500}
          onChange={(e) => {
            setCustom(e.target.value);
            if (e.target.value) setPreset(null);
          }}
        />

        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-[var(--pos-text-muted)]">
          Manager / lead PIN
        </label>
        <input
          className="mt-1 w-full rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-2.5 text-center font-mono text-lg tracking-[0.5em]"
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
          <p className="mt-3 rounded-lg border border-[var(--pos-warn-border)] bg-[var(--pos-warn-soft)] px-3 py-2 text-xs font-semibold text-[var(--pos-warn)]">{request.error}</p>
        ) : null}
        {error ? (
          <p className="mt-3 rounded-lg border border-[var(--pos-danger-border)] bg-[var(--pos-danger-soft)] px-3 py-2 text-xs font-semibold text-[var(--pos-danger)]">{error}</p>
        ) : null}

        <button
          type="button"
          disabled={!ready}
          onClick={approve}
          className="pos-tile mt-4 w-full rounded-xl bg-[var(--pos-warn-solid)] px-4 py-3 text-sm font-bold text-white disabled:opacity-40"
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
/**
 * AM-B — the loyalty discount controls in the checkout rail: redeem the
 * attached member's points in one tap (server sizes the value to what the
 * cart can legally absorb) or apply a code the customer brought. Applied
 * state shows the code + value with a remove button (points refunded).
 * ONLINE-ONLY via onLoyalty; hidden entirely when the bundle predates AM-B.
 */
function LoyaltyRedeemPanel({
  bundle,
  member,
  appliedLoyalty,
  setAppliedLoyalty,
  releaseLoyalty,
  loyaltyFingerprint,
  pricedLines,
  onLoyalty,
  cartEmpty,
}: {
  bundle: PosMenuBundle;
  member: PosMemberHit | null;
  appliedLoyalty: AppliedLoyalty | null;
  setAppliedLoyalty: (a: AppliedLoyalty | null) => void;
  releaseLoyalty: (a: AppliedLoyalty | null) => void;
  loyaltyFingerprint: string;
  pricedLines: PricedSaleLine[];
  onLoyalty: (
    req: PosLoyaltyRequest,
  ) => Promise<{ ok: true; grant: PosLoyaltyGrant } | { ok: false; error: string }>;
  cartEmpty: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeInput, setCodeInput] = useState("");

  const pointValueMinor = bundle.loyalty?.pointValueMinor ?? 0;
  const minRedeemPoints = bundle.loyalty?.minRedeemPoints ?? 0;
  const redeemable = member ? maxRedeemablePoints(member.points, minRedeemPoints) : 0;
  // The most the member's balance could be worth — the server may size it
  // DOWN to the cart's legal capacity; this is only the button's estimate.
  const estimateMinor = Math.floor(redeemable * pointValueMinor);

  const requestLines = () =>
    pricedLines.map((l) => ({
      ...(l.variantId ? { variantId: l.variantId } : {}),
      productId: l.productId,
      category: l.category,
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      regularPriceMinor: l.regularPriceMinor,
    }));

  const grantToApplied = (grant: PosLoyaltyGrant, fingerprint: string): AppliedLoyalty => ({
    redemptionId: grant.redemptionId,
    code: grant.code,
    valueMinor: grant.valueMinor,
    appliedMinor: grant.appliedMinor,
    source: grant.source,
    pointsSpent: grant.pointsSpent,
    fingerprint,
    perVariant: grant.perVariant,
  });

  const redeemPoints = async () => {
    if (!member || busy) return;
    setBusy(true);
    setError(null);
    // Fingerprint captured BEFORE the request: if the cart changes while
    // the server works, the drift effect drops (and refunds) the grant the
    // moment it lands — a spread is only ever honored for its exact cart.
    const requestedFor = loyaltyFingerprint;
    const res = await onLoyalty({ action: "redeem-points", customerId: member.customerId, lines: requestLines() });
    setBusy(false);
    if (res.ok) setAppliedLoyalty(grantToApplied(res.grant, requestedFor));
    else setError(res.error);
  };

  const applyCode = async () => {
    const code = normalizeLoyaltyCodeInput(codeInput);
    if (!code || busy) return;
    setBusy(true);
    setError(null);
    const requestedFor = loyaltyFingerprint;
    const res = await onLoyalty({ action: "apply-code", code, lines: requestLines() });
    setBusy(false);
    if (res.ok) {
      setAppliedLoyalty(grantToApplied(res.grant, requestedFor));
      setCodeOpen(false);
      setCodeInput("");
    } else setError(res.error);
  };

  // Applied state — show what's on, offer removal.
  if (appliedLoyalty) {
    return (
      <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-[var(--pos-accent-border)] bg-[var(--pos-accent-soft)] px-3 py-2">
        <p className="text-xs font-semibold text-[var(--pos-accent)]">
          ★ Loyalty {appliedLoyalty.code} — {money(appliedLoyalty.appliedMinor)} off
          {appliedLoyalty.source === "points" ? ` (${appliedLoyalty.pointsSpent} pts)` : ""}
        </p>
        <button
          type="button"
          onClick={() => {
            releaseLoyalty(appliedLoyalty);
            setAppliedLoyalty(null);
          }}
          className="pos-tile min-h-11 rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--pos-text-muted)]"
        >
          Remove{appliedLoyalty.source === "points" ? " (refund pts)" : ""}
        </button>
      </div>
    );
  }

  const showRedeem = member !== null && redeemable > 0 && pointValueMinor > 0;

  return (
    <div className="mb-3">
      <div className="flex flex-wrap gap-2">
        {showRedeem ? (
          <button
            type="button"
            disabled={busy || cartEmpty}
            onClick={redeemPoints}
            title="Spend the member's points on this sale. The server sizes the discount to what the cart can legally absorb — points are never partially burned."
            className="pos-tile min-h-11 flex-1 rounded-xl border border-[var(--pos-accent-border)] bg-[var(--pos-accent-soft)] px-3 py-2 text-xs font-bold text-[var(--pos-accent)] disabled:opacity-40"
          >
            ★ Redeem {redeemable.toLocaleString("en-US")} pts (~{money(estimateMinor)})
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy || cartEmpty}
          onClick={() => {
            setCodeOpen((v) => !v);
            setError(null);
          }}
          className="pos-tile min-h-11 rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-2 text-xs font-semibold text-[var(--pos-text-muted)] disabled:opacity-40"
        >
          Loyalty code…
        </button>
      </div>
      {codeOpen ? (
        <div className="mt-2 flex gap-2">
          <input
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void applyCode();
            }}
            placeholder="GW-XXXX-XXXX"
            autoCapitalize="characters"
            className="min-w-0 flex-1 rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-2 text-sm uppercase placeholder:text-[var(--pos-text-faint)] focus:border-[var(--pos-accent-border)] focus:outline-none"
          />
          <button
            type="button"
            disabled={busy || normalizeLoyaltyCodeInput(codeInput).length === 0}
            onClick={() => void applyCode()}
            className="pos-tile min-h-11 rounded-xl bg-[var(--pos-accent)] px-4 py-2 text-sm font-bold text-[var(--pos-accent-ink)] disabled:opacity-40"
          >
            Apply
          </button>
        </div>
      ) : null}
      {busy ? <p className="mt-1 text-xs text-[var(--pos-text-faint)]">Checking with the server…</p> : null}
      {error ? (
        <p className="mt-1 rounded-lg border border-[var(--pos-warn-border)] bg-[var(--pos-warn-soft)] px-3 py-1.5 text-xs text-[var(--pos-warn)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** SLICE 28 — human labels for the three special-discount programs. */
const SPECIAL_DISCOUNT_LABELS: Record<SpecialDiscountKind, string> = {
  employee: "Employee discount",
  industry: "Industry discount",
  veteran: "Veteran discount",
};

/**
 * SLICE 28 — the special-discount panel (employee / industry / veteran).
 * Programs come from the bundle (owner-set rates, admin-only page); each
 * collects its facts BEFORE the percent applies:
 *
 *   veteran  — the cashier ticks "I checked a military ID";
 *   industry — the visitor's company name (tracked per-company);
 *   employee — WHO is buying (their own PIN, verified online) + a DIFFERENT
 *              employee's witness PIN, and the buyer can never be the
 *              cashier logged into THIS register (they ring it elsewhere).
 *
 * The math runs through applySpecialDiscountToLines (percent off each line,
 * legal floors always win) and the application pins the cart's fingerprint —
 * any cart change drops it, exactly like loyalty. No stacking: the caller
 * clears any loyalty redemption when a special discount applies.
 */
function SpecialDiscountPanel({
  bundle,
  appliedSpecial,
  setAppliedSpecial,
  loyaltyFingerprint,
  pricedLines,
  onWitness,
  employeeId,
  registerId,
  employeeName,
  cartEmpty,
}: {
  bundle: PosMenuBundle;
  appliedSpecial: AppliedSpecialDiscount | null;
  setAppliedSpecial: (a: AppliedSpecialDiscount | null) => void;
  loyaltyFingerprint: string;
  pricedLines: PricedSaleLine[];
  onWitness?: (pin: string) => Promise<{ ok: true; employee: { id: string; fullName: string } } | { ok: false; error: string }>;
  employeeId?: string;
  registerId?: string;
  employeeName?: string;
  cartEmpty: boolean;
}) {
  const programs = useMemo(() => availableSpecialDiscounts(bundle.specialDiscounts), [bundle.specialDiscounts]);
  const [open, setOpen] = useState<SpecialDiscountKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // veteran
  const [idChecked, setIdChecked] = useState(false);
  // industry
  const [company, setCompany] = useState("");
  // employee — two PIN steps: the buyer identifies themselves, then a
  // DIFFERENT employee witnesses. Both verified online by /api/pos/witness.
  const [buyer, setBuyer] = useState<{ id: string; fullName: string } | null>(null);
  const [pinInput, setPinInput] = useState("");

  const reset = () => {
    setOpen(null);
    setError(null);
    setIdChecked(false);
    setCompany("");
    setBuyer(null);
    setPinInput("");
  };

  const applyProgram = (
    kind: SpecialDiscountKind,
    percentBps: number,
    facts: Partial<AppliedSpecialDiscount>,
  ): string | null => {
    const gate = checkSpecialDiscountAtRegister({
      kind,
      cashierEmployeeId: employeeId ?? "",
      registerId: registerId ?? "",
      beneficiaryEmployeeId: facts.beneficiaryEmployeeId ?? null,
      approvedByEmployeeId: facts.approvedByEmployeeId ?? null,
      companyName: facts.companyName ?? null,
      militaryIdChecked: facts.militaryIdChecked,
    });
    if (gate) return gate;
    const applied = applySpecialDiscountToLines(
      pricedLines.map((l) => ({
        ...(l.variantId ? { variantId: l.variantId } : {}),
        productId: l.productId,
        category: l.category,
        quantity: l.quantity,
        unitPriceMinor: l.unitPriceMinor,
        regularPriceMinor: l.regularPriceMinor,
        // Costs never ride the bundle lines (server-side only); the sync's
        // completion gate re-checks the acquisition-cost floor with the
        // real numbers, so on-device we clamp at the statutory floor.
        costMinorUnits: null,
      })),
      percentBps,
    );
    if (!applied.ok) return applied.reason;
    const perLine: Record<string, number> = {};
    for (const l of applied.lines) {
      if (l.specialDiscountMinor > 0) perLine[l.variantId ?? l.productId] = l.specialDiscountMinor;
    }
    setAppliedSpecial({
      kind,
      percentBps,
      appliedMinor: applied.appliedMinor,
      ...facts,
      fingerprint: loyaltyFingerprint,
      perLine,
    });
    reset();
    return null;
  };

  // Applied state — show what's on, offer removal.
  if (appliedSpecial) {
    return (
      <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-[var(--pos-accent-border)] bg-[var(--pos-accent-soft)] px-3 py-2">
        <p className="text-xs font-semibold text-[var(--pos-accent)]">
          ★ {SPECIAL_DISCOUNT_LABELS[appliedSpecial.kind]} {formatBps(appliedSpecial.percentBps)} — {money(appliedSpecial.appliedMinor)} off
          {appliedSpecial.kind === "employee" && appliedSpecial.beneficiaryName ? ` (${appliedSpecial.beneficiaryName})` : ""}
          {appliedSpecial.kind === "industry" && appliedSpecial.companyName ? ` (${appliedSpecial.companyName})` : ""}
        </p>
        <button
          type="button"
          onClick={() => setAppliedSpecial(null)}
          className="pos-tile min-h-11 rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--pos-text-muted)]"
        >
          Remove
        </button>
      </div>
    );
  }

  if (programs.length === 0) return null;

  const verifyPin = async (): Promise<{ id: string; fullName: string } | null> => {
    if (!onWitness) {
      setError("PIN checks need the register shell — restart the app.");
      return null;
    }
    if (!navigator.onLine) {
      setError("Offline — employee PINs can only be verified with a connection.");
      return null;
    }
    setBusy(true);
    setError(null);
    const res = await onWitness(pinInput);
    setBusy(false);
    setPinInput("");
    if (!res.ok) {
      setError(res.error);
      return null;
    }
    return res.employee;
  };

  return (
    <div className="mb-3">
      <div className="flex flex-wrap gap-2">
        {programs.map((p) => (
          <button
            key={p.kind}
            type="button"
            disabled={cartEmpty || busy}
            onClick={() => {
              setError(null);
              setOpen((v) => (v === p.kind ? null : p.kind));
            }}
            title={
              p.kind === "employee"
                ? "Staff purchase — needs the buying employee's PIN plus a second employee's witness PIN, on a register the buyer is NOT logged into."
                : p.kind === "industry"
                  ? "Visiting vendor/industry guest — records the company name."
                  : "Veteran discount — confirm a military ID first."
            }
            className="pos-tile min-h-11 flex-1 rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-2 text-xs font-semibold text-[var(--pos-text-muted)] disabled:opacity-40"
          >
            {SPECIAL_DISCOUNT_LABELS[p.kind]} {formatBps(p.percentBps)}
          </button>
        ))}
      </div>
      {open === "veteran" ? (
        <div className="mt-2 rounded-xl border border-[var(--pos-border)] bg-[var(--pos-surface-2)] px-3 py-2">
          <label className="flex min-h-11 items-center gap-2 text-xs font-semibold">
            <input type="checkbox" checked={idChecked} onChange={(e) => setIdChecked(e.target.checked)} className="h-5 w-5" />
            I checked a military ID
          </label>
          <button
            type="button"
            disabled={!idChecked}
            onClick={() => {
              const err = applyProgram(
                "veteran",
                programs.find((p) => p.kind === "veteran")!.percentBps,
                { militaryIdChecked: true },
              );
              if (err) setError(err);
            }}
            className="pos-tile mt-2 min-h-11 w-full rounded-xl bg-[var(--pos-accent)] px-4 py-2 text-sm font-bold text-[var(--pos-accent-ink)] disabled:opacity-40"
          >
            Apply veteran discount
          </button>
        </div>
      ) : null}
      {open === "industry" ? (
        <div className="mt-2 rounded-xl border border-[var(--pos-border)] bg-[var(--pos-surface-2)] px-3 py-2">
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Company name (who are they with?)"
            maxLength={120}
            className="w-full rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-surface)] px-3 py-2 text-sm placeholder:text-[var(--pos-text-faint)] focus:border-[var(--pos-accent-border)] focus:outline-none"
          />
          <button
            type="button"
            disabled={company.trim().length < 2}
            onClick={() => {
              const err = applyProgram(
                "industry",
                programs.find((p) => p.kind === "industry")!.percentBps,
                { companyName: company.trim() },
              );
              if (err) setError(err);
            }}
            className="pos-tile mt-2 min-h-11 w-full rounded-xl bg-[var(--pos-accent)] px-4 py-2 text-sm font-bold text-[var(--pos-accent-ink)] disabled:opacity-40"
          >
            Apply industry discount
          </button>
        </div>
      ) : null}
      {open === "employee" ? (
        <div className="mt-2 rounded-xl border border-[var(--pos-border)] bg-[var(--pos-surface-2)] px-3 py-2">
          {!buyer ? (
            <>
              <p className="text-xs font-semibold text-[var(--pos-text-muted)]">
                Step 1 of 2 — the BUYING employee enters their own PIN.
                {employeeName ? ` They can't be ${employeeName} (the cashier logged into this register).` : ""}
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  type="password"
                  inputMode="numeric"
                  placeholder="Buyer's PIN"
                  className="min-w-0 flex-1 rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-surface)] px-3 py-2 text-sm placeholder:text-[var(--pos-text-faint)] focus:border-[var(--pos-accent-border)] focus:outline-none"
                />
                <button
                  type="button"
                  disabled={busy || pinInput.length < 4}
                  onClick={() => {
                    void verifyPin().then((emp) => {
                      if (!emp) return;
                      if (employeeId && emp.id === employeeId) {
                        setError(
                          "That's the cashier logged into THIS register — employees buy on a register they're not logged into.",
                        );
                        return;
                      }
                      setBuyer(emp);
                    });
                  }}
                  className="pos-tile min-h-11 rounded-xl bg-[var(--pos-accent)] px-4 py-2 text-sm font-bold text-[var(--pos-accent-ink)] disabled:opacity-40"
                >
                  Verify
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs font-semibold text-[var(--pos-text-muted)]">
                Step 2 of 2 — buying: <span className="text-[var(--pos-accent)]">{buyer.fullName}</span>. A DIFFERENT
                employee witnesses with their PIN.
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  type="password"
                  inputMode="numeric"
                  placeholder="Witness PIN"
                  className="min-w-0 flex-1 rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-surface)] px-3 py-2 text-sm placeholder:text-[var(--pos-text-faint)] focus:border-[var(--pos-accent-border)] focus:outline-none"
                />
                <button
                  type="button"
                  disabled={busy || pinInput.length < 4}
                  onClick={() => {
                    void verifyPin().then((witness) => {
                      if (!witness) return;
                      if (witness.id === buyer.id) {
                        setError("The witness must be someone OTHER than the buyer.");
                        return;
                      }
                      const err = applyProgram(
                        "employee",
                        programs.find((p) => p.kind === "employee")!.percentBps,
                        {
                          beneficiaryEmployeeId: buyer.id,
                          beneficiaryName: buyer.fullName,
                          approvedByEmployeeId: witness.id,
                          approvedByName: witness.fullName,
                        },
                      );
                      if (err) setError(err);
                    });
                  }}
                  className="pos-tile min-h-11 rounded-xl bg-[var(--pos-accent)] px-4 py-2 text-sm font-bold text-[var(--pos-accent-ink)] disabled:opacity-40"
                >
                  Witness &amp; apply
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
      {busy ? <p className="mt-1 text-xs text-[var(--pos-text-faint)]">Checking with the server…</p> : null}
      {error ? (
        <p className="mt-1 rounded-lg border border-[var(--pos-warn-border)] bg-[var(--pos-warn-soft)] px-3 py-1.5 text-xs text-[var(--pos-warn)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * AO-4 — the customer band (owner-approved register.html mockup). The person
 * owns the top of the sale screen:
 *
 *   - name (member label, or "Walk-in customer"), ID✓age badge, MEDICAL
 *     badge, tier + points badge;
 *   - History / Hold sale / Cancel chips on the right;
 *   - "THE USUAL" one-tap re-add chips built from the member's B29
 *     favorites, matched against TODAY's menu — a chip renders only when
 *     the favorite resolves to exactly ONE variant on the menu (we never
 *     guess which size a "usually buys" means), and adds through the same
 *     manualAdd guard as every other button (scan-required still applies).
 *
 * History auto-loads when a member attaches (the same privacy-budgeted B29
 * call the History button used to make; it is dropped when the sale ends
 * because the whole screen unmounts). The attach/search flow for walk-ins
 * is the existing MemberPanel, unchanged.
 */
function CustomerBand({
  member,
  setMember,
  onMemberLookup,
  onMemberHistory,
  verdict,
  medicalCard,
  menuFetchedAt,
  products,
  onAddUsual,
  holdDisabled,
  onHold,
  onCancel,
}: {
  member: PosMemberHit | null;
  setMember: (m: PosMemberHit | null) => void;
  onMemberLookup?: (q: string) => Promise<{ ok: true; members: PosMemberHit[] } | { ok: false; error: string }>;
  onMemberHistory?: (customerId: string) => Promise<{ ok: true; history: MemberHistory } | { ok: false; error: string }>;
  verdict: Extract<IdGateVerdict, { allowed: true }>;
  medicalCard: PosCardCapture | null;
  menuFetchedAt: string;
  products: PosMenuProduct[];
  onAddUsual: (p: PosMenuProduct) => void;
  holdDisabled: boolean;
  onHold?: () => void;
  onCancel: () => void;
}) {
  const memberId = member?.customerId ?? null;
  // History + drawer state are KEYED to the member they belong to, so a
  // detach/re-attach never needs a reset-in-effect: state for a previous
  // member simply derives to null/closed the moment the id changes.
  const [historyState, setHistoryState] = useState<{ forId: string; history: MemberHistory } | null>(null);
  const [openForId, setOpenForId] = useState<string | null>(null);
  const history = historyState && historyState.forId === memberId ? historyState.history : null;
  const historyOpen = memberId !== null && openForId === memberId;

  // Auto-load the attached member's history (B29) so "THE USUAL" chips can
  // render without a tap. Effect keys off the customerId: attach fetches,
  // re-attach re-fetches. Best-effort — a failure just means no chips.
  useEffect(() => {
    if (!memberId || !onMemberHistory) return;
    let cancelled = false;
    void onMemberHistory(memberId).then((res) => {
      if (!cancelled && res.ok) setHistoryState({ forId: memberId, history: res.history });
    });
    return () => {
      cancelled = true;
    };
    // onMemberHistory is a stable shell callback; keying off it too would
    // refetch on every render of the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  // THE USUAL — favorites resolved against TODAY's menu, kept only when the
  // product name maps to exactly ONE variant (never guess a size).
  const usualChips = useMemo(() => {
    if (!history || history.favorites.length === 0) return [];
    const chips: PosMenuProduct[] = [];
    for (const f of history.favorites) {
      const matches = products.filter((p) => p.name.toLowerCase() === f.productName.toLowerCase());
      if (matches.length === 1 && matches[0].inventoryStatus !== "unavailable") chips.push(matches[0]);
    }
    return chips;
  }, [history, products]);

  const carded = !!medicalCard;

  return (
    <div className="rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface)] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-bold">{member ? member.label : "Walk-in customer"}</h1>
          <span className="rounded-full bg-[var(--pos-accent-soft)] px-2.5 py-0.5 text-xs font-bold text-[var(--pos-accent)]">
            ID ✓ {verdict.age}
          </span>
          {carded && medicalCard ? (
            (() => {
              // Enriched, uncluttered badge next to the customer name: holder
              // type + card expiry; turns red if the card is expired (an
              // expired card grants no exemptions). Card number kept on hover.
              const badge = medicalCardBadge(medicalCard, pacificDayKey(new Date()));
              return (
                <span
                  title={`Recognition card ${medicalCard.upid}${badge.expired ? " — EXPIRED, no exemptions" : ""}`}
                  className={
                    badge.expired
                      ? "rounded-full bg-[var(--pos-danger-solid)] px-2.5 py-0.5 text-xs font-bold text-white"
                      : "rounded-full bg-[var(--pos-info-solid)] px-2.5 py-0.5 text-xs font-bold text-white"
                  }
                >
                  {badge.text}
                </span>
              );
            })()
          ) : null}
          {member ? (
            <span className="rounded-full border border-[var(--pos-warn-border)] bg-[var(--pos-warn-soft)] px-2.5 py-0.5 text-xs font-bold text-[var(--pos-warn)]">
              {member.tierName ? `${member.tierName.toUpperCase()} · ` : ""}
              {member.points.toLocaleString("en-US")} pts
            </span>
          ) : null}
          {member ? (
            <button
              type="button"
              onClick={() => setMember(null)}
              aria-label="Detach this member from the sale"
              title="Detach this member from the sale."
              className="rounded-full border border-[var(--pos-border)] px-2 py-0.5 text-xs font-bold text-[var(--pos-text-faint)]"
            >
              ✕
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {member && onMemberHistory ? (
            <button
              type="button"
              onClick={() => setOpenForId(historyOpen ? null : memberId)}
              className="pos-tile min-h-11 rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-2 text-sm font-semibold"
            >
              🕘 History
            </button>
          ) : null}
          {onHold ? (
            <button
              type="button"
              disabled={holdDisabled}
              onClick={onHold}
              title="Save this sale for later (customer stepped away). Items + counts are kept; load it from the home screen — the ID check re-runs."
              className="pos-tile min-h-11 rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-2 text-sm font-semibold disabled:opacity-40"
            >
              ⏸ Hold sale
            </button>
          ) : null}
          <button
            type="button"
            onClick={onCancel}
            className="pos-tile min-h-11 rounded-lg border border-[var(--pos-border)] bg-[var(--pos-surface-2)] px-3 py-2 text-sm font-semibold text-[var(--pos-danger)]"
          >
            ✕ Cancel
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-[var(--pos-text-faint)]">
        ID verified ({verdict.method}) · menu as of{" "}
        {new Date(menuFetchedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
        {carded ? " · tax exemptions applied per line (RCW 82.08.9998 / WAC 314-55-090)" : ""}
      </p>

      {/* Walk-in: the existing attach/search flow (B14), unchanged. */}
      {!member ? (
        <MemberPanel member={member} setMember={setMember} onMemberLookup={onMemberLookup} onMemberHistory={onMemberHistory} />
      ) : null}

      {/* THE USUAL — one-tap re-adds from B29 favorites. */}
      {usualChips.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--pos-text-faint)]">The usual:</span>
          {usualChips.map((p) => (
            <button
              key={p.variantId}
              type="button"
              onClick={() => onAddUsual(p)}
              title={`Add ${p.name}${p.variantLabel ? ` — ${p.variantLabel}` : ""} to the sale.`}
              className="pos-tile min-h-9 rounded-full border border-[var(--pos-accent-border)] bg-[var(--pos-accent-soft)] px-3 py-1.5 text-xs font-bold text-[var(--pos-accent)]"
            >
              + {p.name}
              {p.variantLabel ? ` · ${p.variantLabel}` : ""}
            </button>
          ))}
        </div>
      ) : null}

      {/* History drawer — the same B29 purchases the old panel showed. */}
      {historyOpen && member ? (
        <div className="mt-2 border-t border-[var(--pos-border)] pt-2">
          {history === null ? (
            <p className="text-xs text-[var(--pos-text-muted)]">Loading…</p>
          ) : history.purchases.length === 0 ? (
            <p className="text-xs text-[var(--pos-text-muted)]">First visit on record — make it a good one.</p>
          ) : (
            <>
              {history.favorites.length > 0 ? (
                <p className="text-xs text-[var(--pos-text-muted)]">
                  <span className="font-semibold">Usually buys:</span>{" "}
                  {history.favorites.map((f) => f.productName).join(" · ")}
                </p>
              ) : null}
              <ul className="mt-1.5 space-y-1">
                {history.purchases.map((p) => (
                  <li key={p.orderId} className="text-xs text-[var(--pos-text-muted)]">
                    <span className="font-semibold text-[var(--pos-text)]">{p.dateLabel}</span> · {money(p.totalMinor)} ·{" "}
                    {p.items.join(", ")}
                    {p.moreCount > 0 ? ` + ${p.moreCount} more` : ""}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

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
      <div className="mt-3 rounded-xl border border-[var(--pos-warn-border)] bg-[var(--pos-warn-soft)] px-4 py-2.5">
        <div className="flex items-center justify-between">
          <span className="text-sm">
            <span className="font-semibold text-[var(--pos-warn)]">★ {member.label}</span>
            <span className="ml-2 text-xs text-[var(--pos-text-muted)]">
              {member.points.toLocaleString()} pts{member.tierName ? ` · ${member.tierName}` : ""}
            </span>
          </span>
          <span className="flex gap-2">
            {onMemberHistory ? (
              <button
                type="button"
                onClick={() => void toggleHistory()}
                className="pos-tile rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--pos-text)]"
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
              className="pos-tile rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--pos-text)]"
            >
              Remove
            </button>
          </span>
        </div>
        {historyOpen ? (
          <div className="mt-2 border-t border-[var(--pos-warn-border)] pt-2">
            {historyBusy ? (
              <p className="text-xs text-[var(--pos-text-muted)]">Loading…</p>
            ) : historyError ? (
              <p className="text-xs text-[var(--pos-warn)]">{historyError}</p>
            ) : history ? (
              history.purchases.length === 0 ? (
                <p className="text-xs text-[var(--pos-text-muted)]">First visit on record — make it a good one.</p>
              ) : (
                <>
                  {history.favorites.length > 0 ? (
                    <p className="text-xs text-[var(--pos-text-muted)]">
                      <span className="font-semibold text-[var(--pos-warn-muted)]">Usually buys:</span>{" "}
                      {history.favorites.map((f) => f.productName).join(" · ")}
                    </p>
                  ) : null}
                  <ul className="mt-1.5 space-y-1">
                    {history.purchases.map((p) => (
                      <li key={p.orderId} className="text-xs text-[var(--pos-text-muted)]">
                        <span className="font-semibold text-[var(--pos-text)]">{p.dateLabel}</span> · {money(p.totalMinor)} ·{" "}
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
    // AM-A — the collapsed customer band: one obvious tap to attach a member
    // (Dutchie puts the customer at the top; so do we).
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 flex min-h-11 w-full items-center gap-2 rounded-xl border border-dashed border-[var(--pos-border-strong)] px-4 py-2.5 text-left text-sm text-[var(--pos-text-muted)] active:bg-[var(--pos-surface-hover)]"
      >
        <span aria-hidden>👤</span> Attach customer — name, phone, or email (optional)
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
    <div className="mt-3 rounded-xl border border-[var(--pos-border)] bg-[var(--pos-surface)] p-3">
      <div className="flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void search();
          }}
          placeholder="Member name, phone, or email…"
          className="flex-1 rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] p-2.5 text-sm"
        />
        <button
          type="button"
          onClick={() => void search()}
          disabled={busy || q.trim().length < 2}
          className="pos-tile rounded-lg bg-[var(--pos-warn-solid)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
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
          className="pos-tile rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-2.5 text-sm"
        >
          ✕
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-[var(--pos-warn)]">{error}</p> : null}
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
                className="flex w-full items-center justify-between rounded-lg border border-[var(--pos-border)] bg-[var(--pos-surface-2)] px-3 py-2.5 text-left active:bg-[var(--pos-surface-hover)]"
              >
                <span className="text-sm font-semibold">{h.label}</span>
                <span className="text-xs text-[var(--pos-text-muted)]">
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
              ? "border border-[var(--pos-accent-border)] bg-[var(--pos-accent-soft)] text-[var(--pos-accent)]"
              : "border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] text-[var(--pos-text)]"
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
  appliedLoyalty,
  appliedSpecial,
  initialTenderedMinor,
  onBack,
  onCancel,
  onPaid,
}: {
  bundle: PosMenuBundle;
  cart: PosCartEntry[];
  medicalCard: PosCardCapture | null;
  /** B24 — this sale's manager price overrides (same map the cart used). */
  overrides: Record<string, PosLineOverride>;
  /** AM-B — the loyalty redemption applied to this sale (reduces the due). */
  appliedLoyalty: AppliedLoyalty | null;
  /** SLICE 28 — the special discount applied to this sale (reduces the due). */
  appliedSpecial: AppliedSpecialDiscount | null;
  /** AO-4 — cash amount pre-entered by a rail quick-tender chip (null = $0). */
  initialTenderedMinor: number | null;
  onBack: () => void;
  onCancel: () => void;
  /** Returns an error string, or null when the sale was enqueued. */
  onPaid: (tenderedMinor: number) => string | null;
}) {
  const priced = useMemo(() => {
    const base = priceForBuyer(cart, bundle, medicalCard !== null, overrides);
    if (appliedLoyalty) {
      // AM-B — the customer owes the loyalty-reduced total; the SAME spread
      // buildSalePayload will apply, so the display and the payload agree.
      const adj = applyLoyaltyToPricedLines(base.lines, appliedLoyalty.perVariant);
      return { ...base, lines: adj.lines, totals: adj.totals };
    }
    if (appliedSpecial) {
      // SLICE 28 — same discipline for a special discount (never both).
      const adj = applySpecialDiscountToPricedLines(base.lines, appliedSpecial.perLine);
      return { ...base, lines: adj.lines, totals: adj.totals };
    }
    return base;
  }, [cart, bundle, medicalCard, overrides, appliedLoyalty, appliedSpecial]);
  const total = priced.totals.totalMinorUnits;
  // B33 — the owner's cash-rounding policy decides the amount DUE at the
  // drawer. TOTAL (and its tax) stays pre-rounded per WA DOR guidance; the
  // adjustment is shown as its own line, Square/Toast style.
  const roundingCfg = useMemo(() => normalizePosCashRoundingConfig(bundle.rounding), [bundle.rounding]);
  const rounded = useMemo(() => roundCashDue(total, roundingCfg.mode), [total, roundingCfg.mode]);
  const due = rounded?.dueMinor ?? total;
  const roundingAdj = rounded?.adjustmentMinor ?? 0;
  // AO-4 — a rail quick-tender chip arrives with the cash already entered.
  const [tendered, setTendered] = useState(initialTenderedMinor ?? 0);
  // AL-B — true when the amount came from the keypad (renders live in the
  // keypad display); a preset chip resets it so the two inputs never fight.
  const [keypadUsed, setKeypadUsed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AL-B — one digit onto the keypad amount. If the current amount came from
  // a CHIP, the keypad starts fresh — appending digits to $30.00 would read
  // $300.0x and surprise everyone.
  const pressKey = (digit: number) => {
    setTendered(tenderKeypadAppend(keypadUsed ? tendered : 0, digit));
    setKeypadUsed(true);
  };

  // B31 — the amounts customers actually hand over: exact, next whole
  // dollar, then $5/$10/$20 steps plus the $50/$100 bills, deduplicated.
  // B33 — chips and count-back run off the ROUNDED due amount.
  const suggestions = useMemo(() => smartTenderSuggestions(due), [due]);
  const change = tendered - due;

  const pay = () => {
    const err = onPaid(tendered);
    if (err) setError(err);
  };

  return (
    <Frame title="Cash tender" onCancel={onCancel}>
      <div className="w-full max-w-md rounded-2xl border border-[var(--pos-accent-border)] bg-[var(--pos-accent-soft)] px-6 py-5 text-center">
        <p className="text-5xl font-bold text-[var(--pos-accent)]">{money(due)}</p>
        <p className="mt-1 text-sm text-[var(--pos-text-muted)]">
          {roundingAdj !== 0 ? "Cash due — cash only at this store." : "Total due — cash only at this store."}
        </p>
        {roundingAdj !== 0 ? (
          <p className="mt-1 text-sm text-[var(--pos-text-muted)]">
            Total {money(total)} · cash rounding {roundingAdj > 0 ? "+" : "−"}
            {money(Math.abs(roundingAdj))} — tax is charged on the pre-rounded total.
          </p>
        ) : null}
        {medicalCard && (priced.med?.medicalSavingsMinor ?? 0) > 0 ? (
          <p className="mt-1 text-sm font-semibold text-[var(--pos-accent)]">
            Medical savings −{money(priced.med?.medicalSavingsMinor ?? 0)} (tax exempt)
          </p>
        ) : null}
        {appliedLoyalty ? (
          <p className="mt-1 text-sm font-semibold text-[var(--pos-accent)]">
            Loyalty {appliedLoyalty.code} −{money(appliedLoyalty.appliedMinor)}
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="mt-4 w-full max-w-md rounded-lg border border-[var(--pos-danger-border)] bg-[var(--pos-danger-soft)] px-4 py-3 text-sm text-[var(--pos-danger)]">{error}</p>
      ) : null}

      {/* AL-B — preset chips FIRST ("don't make me think"): one tap covers
          the overwhelming majority of real tenders. */}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {suggestions.map((amt, i) => (
          <TenderChip
            key={amt}
            label={i === 0 ? `Exact ${money(amt)}` : money(amt)}
            onClick={() => {
              setTendered(amt);
              setKeypadUsed(false);
            }}
            active={tendered === amt}
          />
        ))}
      </div>

      {/* AL-B — a register KEYPAD for odd amounts, replacing the old naked
          text input: cash-register digit entry (2-6-4-1 reads $26.41) is
          the muscle-memory instrument budtenders already know, and big keys
          beat a cramped text field on a touch screen. Pure math lives in
          change-calc-core (tenderKeypadAppend/Backspace, self-tested). */}
      <div className="mt-5 w-full max-w-xs">
        <div
          className={`rounded-xl border px-4 py-2.5 text-center ${
            keypadUsed
              ? "border-[var(--pos-accent-border)] bg-[var(--pos-accent-soft)]"
              : "border-[var(--pos-border)] bg-[var(--pos-surface-2)]"
          }`}
        >
          <span className={`text-2xl font-bold tabular-nums ${keypadUsed ? "text-[var(--pos-accent)]" : "text-[var(--pos-text-faint)]"}`}>
            {keypadUsed ? money(tendered) : "Custom amount"}
          </span>
        </div>
        <div className="mt-2.5 grid grid-cols-3 gap-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <KeyButton key={d} label={d} onPress={() => pressKey(Number(d))} />
          ))}
          <KeyButton label="C" onPress={() => { setTendered(0); setKeypadUsed(false); }} />
          <KeyButton label="0" onPress={() => pressKey(0)} />
          <KeyButton
            label="⌫"
            onPress={() => {
              setTendered(tenderKeypadBackspace(keypadUsed ? tendered : 0));
              setKeypadUsed(true);
            }}
          />
        </div>
      </div>

      <p className={`mt-5 text-2xl font-bold ${change >= 0 ? "text-[var(--pos-accent)]" : "text-[var(--pos-text-faint)]"}`}>
        {change >= 0 ? `${money(change)} change` : `${money(-change)} more needed`}
      </p>
      {tendered >= due && change > 0 ? <ChangePlan changeMinor={change} compact /> : null}

      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={pay}
          disabled={tendered < due}
          className="pos-tile rounded-2xl bg-[var(--pos-accent)] px-10 py-4 text-lg font-bold text-[var(--pos-accent-ink)] disabled:opacity-40"
        >
          Complete sale
        </button>
        <button
          type="button"
          onClick={onBack}
          className="pos-tile rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface-2)] px-6 py-4 text-lg font-semibold"
        >
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
    <main className="pos-shell flex min-h-screen flex-col items-center justify-center p-6">
      <div className="mb-6 flex w-full max-w-lg items-center justify-between">
        <h1 className="text-lg font-semibold">{title}</h1>
        <button
          type="button"
          onClick={onCancel}
          className="pos-tile rounded-lg border border-[var(--pos-border)] bg-[var(--pos-surface-2)] px-4 py-2 text-sm font-semibold"
        >
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
      className={`pos-tile rounded-full px-4 py-2 text-sm font-semibold ${
        active
          ? "bg-[var(--pos-accent)] text-[var(--pos-accent-ink)]"
          : "border border-[var(--pos-border)] bg-[var(--pos-surface-2)] text-[var(--pos-text-muted)]"
      }`}
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
/**
 * SLICE 18D — the tile marker.
 *
 * Tells a budtender, at a glance, that this product counts against one of the
 * two special allowances — WITHOUT them having to know in advance to search
 * for it. Before 18D the register carried the flags and showed nothing: a
 * budtender only found these products by typing a word they had no reason to
 * type.
 *
 * Returns null when the product is in no lane, exactly like StockBadge above.
 * That silence is deliberate and is NOT a claim that the product is ordinary:
 * the flags are optional on PosMenuProduct, so a register running a bundle
 * cached before intake classification looks identical to a genuinely
 * unclassified product. Saying "ordinary" would be a statement we cannot
 * support; saying nothing is honest.
 */
function ClassificationBadge({ product }: { product: PosMenuProduct }) {
  const kinds = productClassifications(product);
  if (kinds.length === 0) return null;
  return (
    <>
      {kinds.map((kind) => (
        <span
          key={kind}
          title={POS_CLASSIFICATION_TITLES[kind]}
          className="ml-2 inline-block rounded bg-[var(--pos-info-soft)] px-1.5 py-0.5 align-middle text-[10px] font-bold tracking-wide text-[var(--pos-info)]"
        >
          {POS_CLASSIFICATION_LABELS[kind]}
        </span>
      ))}
    </>
  );
}

function StockBadge({ product }: { product: PosMenuProduct }) {
  const signal = stockSignal(product.inventoryStatus, product.unitsLeft);
  if (!signal) return null;
  return (
    <span
      className={`ml-2 inline-block rounded px-1.5 py-0.5 align-middle text-[10px] font-bold tracking-wide ${
        signal.severity === "last-units" ? "bg-[var(--pos-danger-soft)] text-[var(--pos-danger)]" : "bg-[var(--pos-warn-soft)] text-[var(--pos-warn)]"
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
      className={`pos-tile rounded-xl px-5 py-3 text-sm font-bold ${
        active
          ? "bg-[var(--pos-accent)] text-[var(--pos-accent-ink)]"
          : "border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)]"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * SLICE 15 FIX A — the refusal that carries its own escape hatch.
 *
 * Slice 14 blocked the oversell correctly but put the only "Sell anyway"
 * button inside a panel gated on `stockBlocks.length > 0`. Because the
 * Phase-2 clamp prevents a cart line from ever exceeding its count, that
 * panel is effectively unreachable — so the refusal message pointed at a
 * button that was not on screen. The owner looked for it and could not find
 * it. This puts the override exactly where the block happens.
 *
 * Deliberately NOT PIN-gated: the owner's decision was that ANY staff member
 * may sell past a stale count, because the person holding the jar knows more
 * than a cached integer. Scan-required and price overrides stay
 * manager-locked; this one does not.
 *
 * The last-refreshed line is the owner's decision Q3 — it is what lets a
 * budtender judge how much to trust the number they are overriding.
 */
function StockOverrideOffer({
  offer,
  menuAgeLabel,
  onOverride,
  onDismiss,
}: {
  offer: string | null;
  menuAgeLabel: string;
  onOverride: () => void;
  onDismiss: () => void;
}) {
  if (!offer) return null;
  return (
    <div className="mt-2 rounded-xl border border-[var(--pos-danger-border)] bg-[var(--pos-danger-soft)] px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold text-[var(--pos-danger)]">{offer}</p>
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="text-xs font-bold text-[var(--pos-text-muted)]">
          ✕
        </button>
      </div>
      <p className="mt-1 text-[11px] text-[var(--pos-text-muted)]">
        Stock counts come from the menu last refreshed {menuAgeLabel}. If the product is physically on the shelf, sell
        it anyway and the count will be reconciled.
      </p>
      <button
        type="button"
        onClick={onOverride}
        data-stock-override-offer
        className="pos-tile mt-2 min-h-11 w-full rounded-lg border border-[var(--pos-danger-border)] bg-[var(--pos-surface)] px-4 py-2 text-xs font-bold text-[var(--pos-danger)]"
      >
        Sell anyway — the unit is on the shelf
      </button>
    </div>
  );
}

function QtyButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pos-tile h-11 w-11 rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface)] text-xl font-bold active:bg-[var(--pos-surface-hover)]"
    >
      {label}
    </button>
  );
}

function Row({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`flex justify-between ${accent ? "text-[var(--pos-accent)]" : "text-[var(--pos-text-muted)]"}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function money(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

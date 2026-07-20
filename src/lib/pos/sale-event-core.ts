/**
 * src/lib/pos/sale-event-core.ts  (POS Slice B2)
 *
 * PURE core for the register's offline-first event envelope + cash-tender
 * math. No React, no DB, no server-only — the SAME code runs inside the iPad
 * app (Capacitor bundle) and on the server sync route, so both sides agree on
 * what a valid event is (POS_FRONTEND_RESEARCH §4; POS_SEAM_AUDIT Seam 2/3).
 *
 * Design rules (verified in docs/POS_FRONTEND_RESEARCH.md):
 *  - Every event is an APPEND-ONLY, IMMUTABLE fact with a client-generated
 *    UUID; the server upserts on that UUID so a retried flush can never
 *    double-post (idempotency).
 *  - Money is MINOR UNITS (cents) everywhere.
 *  - Payment methods are a pluggable enum from day one: cash now;
 *    point_of_banking / ach / debit reserved (owner decision §14: cash-only
 *    launch, POSaBIT pre-approved). Non-cash methods are DISABLED until the
 *    owner enables a processor — the validator hard-blocks them.
 *  - Punch events carry INTENT (in|out), never a blind toggle, so an offline
 *    replay can assert rather than flip state (POS_SEAM_AUDIT Seam 4 gap).
 */

// ---------------------------------------------------------------------------
// Payment methods
// ---------------------------------------------------------------------------

export const POS_PAYMENT_METHODS = ["cash", "point_of_banking", "ach", "debit"] as const;
export type PosPaymentMethod = (typeof POS_PAYMENT_METHODS)[number];

/**
 * Methods currently allowed at the till. Owner decision (research §14):
 * CASH-ONLY at launch; POSaBIT (point_of_banking/debit) pre-approved for the
 * future but NOT enabled. Enabling later = config change, not surgery.
 */
export const ENABLED_PAYMENT_METHODS: ReadonlySet<PosPaymentMethod> = new Set(["cash"]);

export function isPaymentMethodEnabled(method: string): method is PosPaymentMethod {
  return (POS_PAYMENT_METHODS as readonly string[]).includes(method) &&
    ENABLED_PAYMENT_METHODS.has(method as PosPaymentMethod);
}

// ---------------------------------------------------------------------------
// Cash tender math (no mental math at the register — ever)
// ---------------------------------------------------------------------------

export type CashTender = {
  /** Order total in minor units (tax-inclusive, from computeOrderTotals). */
  totalMinor: number;
  /** Cash received from the customer in minor units. */
  tenderedMinor: number;
};

export type CashTenderResult =
  | { ok: true; changeMinor: number }
  | { ok: false; error: string };

/** Validate a cash tender and compute exact change. */
export function computeCashChange(t: CashTender): CashTenderResult {
  if (!Number.isInteger(t.totalMinor) || t.totalMinor < 0) {
    return { ok: false, error: "Order total must be a non-negative integer (cents)." };
  }
  if (!Number.isInteger(t.tenderedMinor) || t.tenderedMinor < 0) {
    return { ok: false, error: "Tendered amount must be a non-negative integer (cents)." };
  }
  if (t.tenderedMinor < t.totalMinor) {
    const short = t.totalMinor - t.tenderedMinor;
    return { ok: false, error: `Tendered cash is short by ${(short / 100).toFixed(2)}.` };
  }
  return { ok: true, changeMinor: t.tenderedMinor - t.totalMinor };
}

// ---------------------------------------------------------------------------
// Event envelope
// ---------------------------------------------------------------------------

export const POS_EVENT_TYPES = [
  /** A completed register sale (order payload + tender). */
  "sale",
  /** Clock in/out with explicit intent. */
  "punch",
  /** Drawer open without a sale (no-sale) — manager PIN + reason required. */
  "no_sale",
  /** ID verification performed manually (audit trail; WAC 314-55-150 list). */
  "manual_id_verification",
  /**
   * Recognition-card capture for a medical sale (POS B8). Enqueued BEFORE the
   * sale that references it (same discipline as manual_id_verification) so the
   * card facts + MCR attestation are an audit fact even if the sale is
   * abandoned. Requires migration 0121.
   */
  "medical_card_capture",
] as const;
export type PosEventType = (typeof POS_EVENT_TYPES)[number];

/** RFC-4122-shaped UUID check (any version; the client generates v4). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** ISO-8601 timestamp with timezone (what `new Date().toISOString()` emits). */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

export function isIsoTimestamp(v: unknown): v is string {
  return typeof v === "string" && ISO_RE.test(v) && !Number.isNaN(Date.parse(v));
}

export type PosEventEnvelope = {
  /** Client-generated UUID — the idempotency key. NEVER reused. */
  clientUuid: string;
  /** Which provisioned iPad produced this event. */
  deviceId: string;
  /** Which register the device was bound to. */
  registerId: string;
  /** The employee (employees.id) who owned the action (PIN unlock). */
  employeeId: string;
  /** Monotonic per-device sequence — preserves offline ordering on replay. */
  sequence: number;
  /** Device wall-clock when the event was finalized (ISO-8601 w/ zone). */
  occurredAt: string;
  eventType: PosEventType;
  /** Event-type-specific payload (validated separately per type). */
  payload: Record<string, unknown>;
};

export type EnvelopeCheck = { ok: true } | { ok: false; errors: string[] };

/** Validate the common envelope every POS event must carry. */
export function validateEnvelope(e: Partial<PosEventEnvelope>): EnvelopeCheck {
  const errors: string[] = [];
  if (!isUuid(e.clientUuid)) errors.push("clientUuid must be a UUID.");
  if (!isUuid(e.deviceId)) errors.push("deviceId must be a UUID.");
  if (!isUuid(e.registerId)) errors.push("registerId must be a UUID.");
  if (!isUuid(e.employeeId)) errors.push("employeeId must be a UUID.");
  if (!Number.isInteger(e.sequence) || (e.sequence as number) < 0) {
    errors.push("sequence must be a non-negative integer.");
  }
  if (!isIsoTimestamp(e.occurredAt)) errors.push("occurredAt must be an ISO-8601 timestamp.");
  if (!e.eventType || !(POS_EVENT_TYPES as readonly string[]).includes(e.eventType)) {
    errors.push(`eventType must be one of: ${POS_EVENT_TYPES.join(", ")}.`);
  }
  if (e.payload == null || typeof e.payload !== "object" || Array.isArray(e.payload)) {
    errors.push("payload must be an object.");
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

// ---------------------------------------------------------------------------
// Sale payload
// ---------------------------------------------------------------------------

export type PosSaleLine = {
  productId: string;
  productName: string;
  /** Category snapshot at sale time (drives tax divisor + limit mapping). */
  category: string;
  quantity: number;
  /** Final (post-discount) tax-inclusive unit price, minor units. */
  unitPriceMinor: number;
  /** Pre-discount tax-inclusive unit price, minor units. */
  regularPriceMinor: number;
  /**
   * The sold variant's source_variant_id (POS B20). OPTIONAL so sales queued
   * by pre-B20 registers still validate and sync. When present it lands on
   * order_lines.variant_id, giving the B19 inventory decrement an EXACT
   * variant match (no label fallback) and the CCRS export a precise line.
   */
  variantId?: string;
  /**
   * Manager price override applied to this line at the register (POS B24).
   * OPTIONAL so pre-B24 queued sales still validate. `unitPriceMinor` above
   * IS the overridden (charged) price; this block records what the engine
   * would have charged, why the manager changed it, and which manager
   * approved it. The approver was verified server-side by /api/pos/approve
   * (scrypt PIN + role gate) moments before enqueue — the PIN itself never
   * rides in any queue payload. The sync audits every overridden line.
   */
  override?: {
    /** The engine-computed unit price this override replaced (minor units). */
    originalUnitPriceMinor: number;
    /** Why the price was changed (3–500 chars — same discipline as no-sale). */
    reason: string;
    /** employees.id of the approving manager/lead. */
    approvedByEmployeeId: string;
  };
  /**
   * Per-UNIT loyalty reduction taken by a redemption code (Task AM-B).
   * OPTIONAL so pre-AM-B queued sales still validate. `unitPriceMinor` above
   * IS the reduced (charged) price; this records how much of it the code
   * paid, and at sync it lands on order_lines.loyalty_discount_minor_units
   * (migration 0116) — the same per-line snapshot the back office writes.
   * Only valid when the payload carries a `loyaltyRedemption` block.
   */
  loyaltyDiscountMinor?: number;
  /**
   * AN-1 — grams ONE unit of the sold variant weighs, from the menu bundle
   * (parsed server-side from the package label: "3.5g" → 3.5, "1oz" → 28).
   * OPTIONAL so pre-AN-1 queued sales still validate; absent/null = unknown
   * → the server's WAC 314-55-095 gate falls back to the category default.
   * At sync it snapshots onto order_lines.unit_grams (migration 0122).
   */
  unitGrams?: number | null;
};

export type PosSalePayload = {
  lines: PosSaleLine[];
  /** Totals as the DEVICE computed them (server recomputes and must match). */
  totalMinor: number;
  subtotalMinor: number;
  taxMinor: number;
  paymentMethod: PosPaymentMethod;
  /** Cash received (cash sales). Required when paymentMethod === "cash". */
  tenderedMinor?: number;
  changeMinor?: number;
  /** The drawer session this sale belongs to (open DrawerSession id). */
  drawerSessionId: string;
  /**
   * Present when this register sale was STARTED from a website pickup order
   * loaded into the register ("the customer is here and wants to add items").
   * It is the source order's UUID. The website order is NO LONGER superseded
   * at load time (that lost the order + its revenue if the sale was abandoned
   * or the screen locked). Instead the source order stays ACTIVE and is
   * superseded (cancelled with the loud timeline note) EXACTLY when THIS
   * register sale COMPLETES and materializes its own order at sync — so the
   * two can never both fulfill, and an abandoned load simply leaves the
   * website order untouched. Omitted for ordinary walk-in sales.
   */
  sourceOrderId?: string;
  /** How the customer's ID was verified before the cart was started. */
  idVerification: { method: "scan" | "manual"; manualEventUuid?: string };
  /**
   * Present when this is a MEDICAL sale (POS B7/B8): the captured recognition
   * card + the client UUID of its medical_card_capture audit event + the
   * savings the device passed through. Deep validation (card dates vs the
   * sale date, MCR attestation) runs in medical-pos-core on-device BEFORE
   * enqueue and again server-side at sync; here we enforce the structural
   * invariants every enqueued sale must satisfy.
   */
  medical?: {
    card: {
      upid: string;
      effectiveOn: string;
      expiresOn: string;
      holderType: "patient" | "designated_provider";
      mcrVerified: boolean;
    };
    cardEventUuid: string;
    medicalSavingsMinor: number;
  };
  /**
   * Present when a LOYALTY MEMBER was attached at the register (POS B14).
   * The customerId came from the server's own member lookup, so at sync it
   * MUST resolve — a dangling id is an exception, never a silent drop. The
   * sync writes orders.customer_id, which makes the EXISTING completion
   * accrual (setOrderStatus → accrueForOrder) earn the points; the register
   * never computes authoritative points.
   */
  loyalty?: {
    /** customers.id from the /api/pos/member lookup. */
    customerId: string;
    /** Display label frozen at attach time (receipt + exception readability). */
    memberLabel: string;
  };
  /**
   * Present when a loyalty REDEMPTION CODE was applied at the register
   * (Task AM-B). The code was issued (or looked up) ONLINE moments before
   * enqueue by /api/pos/loyalty, which computed the per-line spread with the
   * SAME pure spreadCodeValue + legal floors the back office uses; the
   * reduced prices already live in the lines above (each reduced line
   * carries its loyaltyDiscountMinor). At sync the server re-verifies the
   * redemption row, ATOMICALLY claims it against the materialized order
   * (markRedemptionUsed — two registers can't both win), and writes the
   * migration-0116 loyalty columns so the EXISTING completion gate's code
   * check (checkLoyaltyCodeForCompletion) passes untouched.
   */
  loyaltyRedemption?: {
    /** loyalty_redemptions.id the device applied. */
    redemptionId: string;
    /** The human code (GW-XXXX-XXXX) — receipts + exception readability. */
    code: string;
    /** Σ per-line loyaltyDiscountMinor × quantity (server re-sums and must match). */
    appliedMinor: number;
  };
  /**
   * Present when CASH ROUNDING adjusted the amount due (POS B33). WA DOR
   * interim guidance: tax is computed on the PRE-ROUNDED price, so
   * totalMinor/subtotalMinor/taxMinor above stay exactly as priced and the
   * rounding travels as its own auditable block. Omitted when the policy is
   * off or the total already lands on a nickel — pre-B33 payload shapes stay
   * byte-identical. When present, the cash-tender check runs against
   * dueMinor (the cash actually owed at the drawer).
   */
  rounding?: {
    /** The owner's policy that produced this adjustment. */
    mode: "nearest" | "up" | "down";
    /** dueMinor − totalMinor. Never 0 (omit the block instead); |x| ≤ 4. */
    adjustmentMinor: number;
    /** Cash amount due after rounding — always a multiple of 5 cents. */
    dueMinor: number;
  };
};

export type SalePayloadCheck = { ok: true } | { ok: false; errors: string[] };

export function validateSalePayload(p: Partial<PosSalePayload>): SalePayloadCheck {
  const errors: string[] = [];
  if (!Array.isArray(p.lines) || p.lines.length === 0) {
    errors.push("A sale must contain at least one line.");
  } else {
    p.lines.forEach((l, i) => {
      if (!l || typeof l !== "object") { errors.push(`Line ${i + 1} is not an object.`); return; }
      if (typeof l.productId !== "string" || !l.productId.trim()) errors.push(`Line ${i + 1}: productId required.`);
      if (typeof l.productName !== "string" || !l.productName.trim()) errors.push(`Line ${i + 1}: productName required.`);
      if (typeof l.category !== "string" || !l.category.trim()) errors.push(`Line ${i + 1}: category snapshot required.`);
      if (!Number.isInteger(l.quantity) || l.quantity < 1) errors.push(`Line ${i + 1}: quantity must be a positive integer.`);
      if (!Number.isInteger(l.unitPriceMinor) || l.unitPriceMinor < 0) errors.push(`Line ${i + 1}: unitPriceMinor must be a non-negative integer.`);
      if (!Number.isInteger(l.regularPriceMinor) || l.regularPriceMinor < 0) errors.push(`Line ${i + 1}: regularPriceMinor must be a non-negative integer.`);
      // POS B20: variantId is OPTIONAL (pre-B20 queues omit it) but when
      // present it must be a non-empty string — a blank id is corruption.
      if (l.variantId !== undefined && (typeof l.variantId !== "string" || !l.variantId.trim())) {
        errors.push(`Line ${i + 1}: variantId, when present, must be a non-empty string.`);
      }
      // AN-1: unitGrams is OPTIONAL (pre-AN-1 queues omit it; null = unknown
      // weight) but when present-and-non-null it must be a positive finite
      // number — garbage weights never reach the server's limit gate.
      if (l.unitGrams !== undefined && l.unitGrams !== null) {
        if (typeof l.unitGrams !== "number" || !Number.isFinite(l.unitGrams) || l.unitGrams <= 0) {
          errors.push(`Line ${i + 1}: unitGrams, when present, must be a positive number (grams per unit).`);
        }
      }
      // Task AM-B: optional per-UNIT loyalty reduction — a whole-cent
      // positive integer that never exceeds the charged price context
      // (unitPriceMinor is the ALREADY-reduced price, so the reduction must
      // leave the pre-loyalty price ≥ reduction + 1 cent implicitly; the
      // sync re-verifies against the redemption row).
      if (l.loyaltyDiscountMinor !== undefined) {
        if (!Number.isInteger(l.loyaltyDiscountMinor) || l.loyaltyDiscountMinor <= 0) {
          errors.push(`Line ${i + 1}: loyaltyDiscountMinor, when present, must be a positive integer (cents).`);
        }
      }
      // POS B24: the manager price-override block is OPTIONAL, but when
      // present it must be complete and coherent — the charged price must be
      // a genuine MARKDOWN of the recorded engine price, the reason must meet
      // the no-sale discipline, and the approver must be an employees.id.
      if (l.override !== undefined) {
        const o = l.override;
        if (o == null || typeof o !== "object") {
          errors.push(`Line ${i + 1}: override, when present, must be an object.`);
        } else {
          if (!Number.isInteger(o.originalUnitPriceMinor) || o.originalUnitPriceMinor <= 0) {
            errors.push(`Line ${i + 1}: override.originalUnitPriceMinor must be a positive integer (cents).`);
          } else if (Number.isInteger(l.unitPriceMinor) && l.unitPriceMinor >= o.originalUnitPriceMinor) {
            errors.push(`Line ${i + 1}: an override must LOWER the price — charged unit price must be below override.originalUnitPriceMinor.`);
          }
          const reason = typeof o.reason === "string" ? o.reason.trim() : "";
          if (reason.length < 3) errors.push(`Line ${i + 1}: override.reason must be at least 3 characters.`);
          if (reason.length > 500) errors.push(`Line ${i + 1}: override.reason is too long (max 500 characters).`);
          if (!isUuid(o.approvedByEmployeeId)) {
            errors.push(`Line ${i + 1}: override.approvedByEmployeeId must be the approving manager's employee id.`);
          }
        }
      }
    });
  }
  for (const k of ["totalMinor", "subtotalMinor", "taxMinor"] as const) {
    if (!Number.isInteger(p[k]) || (p[k] as number) < 0) errors.push(`${k} must be a non-negative integer.`);
  }
  const method = p.paymentMethod ?? "";
  if (!isPaymentMethodEnabled(method)) {
    errors.push(
      (POS_PAYMENT_METHODS as readonly string[]).includes(method)
        ? `Payment method "${method}" is not enabled at this store (cash-only launch).`
        : "paymentMethod is missing or unknown.",
    );
  }
  // POS B33 — optional cash-rounding block. When present it must be
  // internally coherent: a real nickel adjustment (never 0, |x| ≤ 4), a due
  // amount that lands on the nickel, and due = total + adjustment. Tax stays
  // on the PRE-ROUNDED total (WA DOR interim guidance) — the block never
  // touches totalMinor/subtotalMinor/taxMinor.
  let roundedDueMinor: number | null = null;
  if (p.rounding !== undefined) {
    const rb = p.rounding;
    if (rb == null || typeof rb !== "object") {
      errors.push("rounding, when present, must be an object.");
    } else if (rb.mode !== "nearest" && rb.mode !== "up" && rb.mode !== "down") {
      errors.push('rounding.mode must be "nearest", "up", or "down".');
    } else if (!Number.isInteger(rb.adjustmentMinor) || rb.adjustmentMinor === 0 || Math.abs(rb.adjustmentMinor) > 4) {
      errors.push("rounding.adjustmentMinor must be a non-zero integer within ±4 cents (omit the block when no adjustment applies).");
    } else if (!Number.isInteger(rb.dueMinor) || rb.dueMinor < 0 || rb.dueMinor % 5 !== 0) {
      errors.push("rounding.dueMinor must be a non-negative multiple of 5 cents.");
    } else if (Number.isInteger(p.totalMinor) && rb.dueMinor !== (p.totalMinor as number) + rb.adjustmentMinor) {
      errors.push("rounding.dueMinor must equal totalMinor + rounding.adjustmentMinor.");
    } else if (rb.mode === "up" && rb.adjustmentMinor < 0) {
      errors.push("rounding.adjustmentMinor cannot be negative when mode is \"up\".");
    } else if (rb.mode === "down" && rb.adjustmentMinor > 0) {
      errors.push("rounding.adjustmentMinor cannot be positive when mode is \"down\".");
    } else {
      roundedDueMinor = rb.dueMinor;
    }
  }
  if (method === "cash") {
    if (!Number.isInteger(p.tenderedMinor)) {
      errors.push("Cash sales must record tenderedMinor.");
    } else if (Number.isInteger(p.totalMinor)) {
      // B33: the customer owes the ROUNDED due amount when rounding applied.
      const owedMinor = roundedDueMinor ?? (p.totalMinor as number);
      const tender = computeCashChange({
        totalMinor: owedMinor,
        tenderedMinor: p.tenderedMinor as number,
      });
      if (!tender.ok) errors.push(tender.error);
      else if (p.changeMinor !== undefined && p.changeMinor !== tender.changeMinor) {
        errors.push("changeMinor does not match tendered − amount due.");
      }
    }
  }
  if (!isUuid(p.drawerSessionId)) errors.push("drawerSessionId must be a UUID (sale must belong to an open drawer).");
  // Optional: when a sale was started from a loaded website order, its source
  // order id must be a real UUID (omitted for walk-ins so pre-existing payload
  // shapes stay byte-identical).
  if (p.sourceOrderId !== undefined && !isUuid(p.sourceOrderId)) {
    errors.push("sourceOrderId, when present, must be the source website order's UUID.");
  }
  const idv = p.idVerification;
  if (!idv || (idv.method !== "scan" && idv.method !== "manual")) {
    errors.push('idVerification.method must be "scan" or "manual" — a sale cannot exist without an ID gate result.');
  } else if (idv.method === "manual" && !isUuid(idv.manualEventUuid)) {
    errors.push("Manual ID verification must reference its manual_id_verification event UUID (audit trail).");
  }
  if (p.medical !== undefined) {
    const m = p.medical;
    if (m == null || typeof m !== "object") {
      errors.push("medical must be an object when present.");
    } else {
      const card = m.card;
      if (card == null || typeof card !== "object") {
        errors.push("medical.card (the captured recognition card) is required on a medical sale.");
      } else {
        if (typeof card.upid !== "string" || card.upid.trim().length < 4 || card.upid.trim().length > 64) {
          errors.push("medical.card.upid must be the recognition card's unique patient identifier (4–64 chars).");
        }
        if (typeof card.effectiveOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(card.effectiveOn)) {
          errors.push("medical.card.effectiveOn must be YYYY-MM-DD.");
        }
        if (typeof card.expiresOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(card.expiresOn)) {
          errors.push("medical.card.expiresOn must be YYYY-MM-DD.");
        }
        if (card.holderType !== "patient" && card.holderType !== "designated_provider") {
          errors.push('medical.card.holderType must be "patient" or "designated_provider".');
        }
        if (card.mcrVerified !== true) {
          errors.push(
            "medical.card.mcrVerified must be true — the consultant must verify the card in the DOH Medical Cannabis Database before a medical sale (WAC 246-71).",
          );
        }
      }
      if (!isUuid(m.cardEventUuid)) {
        errors.push("Medical sale must reference its medical_card_capture event UUID (audit trail).");
      }
      if (!Number.isInteger(m.medicalSavingsMinor) || m.medicalSavingsMinor < 0) {
        errors.push("medical.medicalSavingsMinor must be a non-negative integer (cents).");
      }
    }
  }
  if (p.loyalty !== undefined) {
    const ly = p.loyalty;
    if (ly == null || typeof ly !== "object") {
      errors.push("loyalty must be an object when present.");
    } else {
      if (!isUuid(ly.customerId)) {
        errors.push("loyalty.customerId must be a UUID (from the member lookup).");
      }
      const label = typeof ly.memberLabel === "string" ? ly.memberLabel.trim() : "";
      if (!label || label.length > 80) {
        errors.push("loyalty.memberLabel must be 1–80 characters.");
      }
    }
  }
  // Task AM-B — optional loyalty-redemption block. When present it must be
  // coherent with the lines: appliedMinor must equal the sum of the per-line
  // reductions × quantity, and at least one line must carry a reduction.
  // Per-line reductions WITHOUT the block are corruption (orphaned discount).
  const lineLoyaltySum = Array.isArray(p.lines)
    ? p.lines.reduce(
        (s, l) =>
          s +
          (l && Number.isInteger(l.loyaltyDiscountMinor) && Number.isInteger(l.quantity)
            ? (l.loyaltyDiscountMinor as number) * (l.quantity as number)
            : 0),
        0,
      )
    : 0;
  if (p.loyaltyRedemption !== undefined) {
    const lr = p.loyaltyRedemption;
    if (lr == null || typeof lr !== "object") {
      errors.push("loyaltyRedemption must be an object when present.");
    } else {
      if (!isUuid(lr.redemptionId)) {
        errors.push("loyaltyRedemption.redemptionId must be a UUID (loyalty_redemptions.id).");
      }
      const code = typeof lr.code === "string" ? lr.code.trim() : "";
      if (!code || code.length > 20) {
        errors.push("loyaltyRedemption.code must be 1–20 characters.");
      }
      if (!Number.isInteger(lr.appliedMinor) || lr.appliedMinor <= 0) {
        errors.push("loyaltyRedemption.appliedMinor must be a positive integer (cents).");
      } else if (lr.appliedMinor !== lineLoyaltySum) {
        errors.push(
          "loyaltyRedemption.appliedMinor must equal the sum of per-line loyaltyDiscountMinor × quantity.",
        );
      }
    }
  } else if (lineLoyaltySum > 0) {
    errors.push(
      "Lines carry loyaltyDiscountMinor but the payload has no loyaltyRedemption block — orphaned discount refused.",
    );
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

// ---------------------------------------------------------------------------
// Punch payload (intent-carrying — POS_SEAM_AUDIT Seam 4)
// ---------------------------------------------------------------------------

export type PosPunchPayload = {
  /** Explicit intent — the replay ASSERTS this, never blind-toggles. */
  intent: "in" | "out";
};

export function validatePunchPayload(p: Partial<PosPunchPayload>): SalePayloadCheck {
  if (p.intent !== "in" && p.intent !== "out") {
    return { ok: false, errors: ['punch intent must be "in" or "out".'] };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// No-sale payload (drawer opened without a sale — tight cash control)
// ---------------------------------------------------------------------------

export type PosNoSalePayload = {
  reason: string;
  /** Manager (employees.id) who approved the no-sale open. */
  approvedByEmployeeId: string;
};

export function validateNoSalePayload(p: Partial<PosNoSalePayload>): SalePayloadCheck {
  const errors: string[] = [];
  const reason = (p.reason ?? "").trim();
  if (reason.length < 3) errors.push("No-sale requires a reason (at least 3 characters).");
  if (reason.length > 500) errors.push("No-sale reason is too long (max 500 characters).");
  if (!isUuid(p.approvedByEmployeeId)) errors.push("No-sale requires the approving manager's employee id.");
  return errors.length ? { ok: false, errors } : { ok: true };
}

// ---------------------------------------------------------------------------
// Ordering helper — replay a device's queue in true offline order
// ---------------------------------------------------------------------------

/** Sort events for replay: per device, by monotonic sequence, then time. */
export function sortEventsForReplay<T extends Pick<PosEventEnvelope, "deviceId" | "sequence" | "occurredAt">>(
  events: T[],
): T[] {
  return [...events].sort((a, b) => {
    if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1;
    if (a.sequence !== b.sequence) return a.sequence - b.sequence;
    return Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
  });
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runPosSaleEventTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else { fail += 1; console.log("FAIL:", msg); }
  };

  const U1 = "11111111-1111-4111-8111-111111111111";
  const U2 = "22222222-2222-4222-8222-222222222222";
  const U3 = "33333333-3333-4333-8333-333333333333";
  const U4 = "44444444-4444-4444-8444-444444444444";
  const U5 = "55555555-5555-4555-8555-555555555555";

  // Payment enum
  ok(isPaymentMethodEnabled("cash"), "cash enabled");
  ok(!isPaymentMethodEnabled("debit"), "debit disabled at launch");
  ok(!isPaymentMethodEnabled("point_of_banking"), "point_of_banking disabled at launch");
  ok(!isPaymentMethodEnabled("credit"), "unknown method rejected");

  // Cash change
  {
    const r = computeCashChange({ totalMinor: 2926, tenderedMinor: 4000 });
    ok(r.ok && r.changeMinor === 1074, "change = 40.00 - 29.26 = 10.74");
  }
  ok(!computeCashChange({ totalMinor: 2926, tenderedMinor: 2000 }).ok, "short tender refused");
  ok(!computeCashChange({ totalMinor: 29.26 as unknown as number, tenderedMinor: 4000 }).ok, "non-integer total refused");
  {
    const r = computeCashChange({ totalMinor: 0, tenderedMinor: 0 });
    ok(r.ok && r.changeMinor === 0, "zero-total edge ok");
  }

  // Envelope
  const goodEnv: PosEventEnvelope = {
    clientUuid: U1, deviceId: U2, registerId: U3, employeeId: U4,
    sequence: 7, occurredAt: "2026-07-13T10:00:00.000Z", eventType: "sale", payload: {},
  };
  ok(validateEnvelope(goodEnv).ok, "good envelope passes");
  ok(!validateEnvelope({ ...goodEnv, clientUuid: "nope" }).ok, "bad uuid refused");
  ok(!validateEnvelope({ ...goodEnv, sequence: -1 }).ok, "negative sequence refused");
  ok(!validateEnvelope({ ...goodEnv, occurredAt: "yesterday" }).ok, "bad timestamp refused");
  ok(!validateEnvelope({ ...goodEnv, eventType: "refund" as PosEventType }).ok, "unknown type refused");
  ok(validateEnvelope({ ...goodEnv, occurredAt: "2026-07-13T10:00:00-07:00" }).ok, "offset timestamp ok");

  // Sale payload
  const goodSale: PosSalePayload = {
    lines: [{
      productId: "prod-1", productName: "Blue Dream 3.5g", category: "flower",
      quantity: 2, unitPriceMinor: 1463, regularPriceMinor: 1463,
    }],
    totalMinor: 2926, subtotalMinor: 2000, taxMinor: 926,
    paymentMethod: "cash", tenderedMinor: 3000, changeMinor: 74,
    drawerSessionId: U5,
    idVerification: { method: "scan" },
  };
  ok(validateSalePayload(goodSale).ok, "good cash sale passes");
  // Optional sourceOrderId (loaded-from-website-order): valid UUID passes,
  // garbage refused, absent stays fine.
  ok(validateSalePayload({ ...goodSale, sourceOrderId: U1 }).ok, "sale with valid sourceOrderId passes");
  ok(!validateSalePayload({ ...goodSale, sourceOrderId: "not-a-uuid" }).ok, "sale with bad sourceOrderId refused");
  ok(!validateSalePayload({ ...goodSale, lines: [] }).ok, "empty lines refused");
  ok(!validateSalePayload({ ...goodSale, paymentMethod: "debit" as PosPaymentMethod }).ok, "debit sale blocked at launch");
  ok(!validateSalePayload({ ...goodSale, tenderedMinor: 2000 }).ok, "short cash refused");
  ok(!validateSalePayload({ ...goodSale, changeMinor: 999 }).ok, "wrong change refused");
  ok(!validateSalePayload({ ...goodSale, tenderedMinor: undefined }).ok, "cash without tendered refused");

  // POS B33 — optional cash-rounding block.
  const roundedSale: PosSalePayload = {
    ...goodSale,
    rounding: { mode: "nearest", adjustmentMinor: -1, dueMinor: 2925 },
    tenderedMinor: 3000,
    changeMinor: 75, // change runs off the ROUNDED due (3000 − 2925)
  };
  ok(validateSalePayload(roundedSale).ok, "rounded sale passes — change against dueMinor");
  ok(
    !validateSalePayload({ ...roundedSale, changeMinor: 74 }).ok,
    "rounded sale with change against the PRE-rounded total refused",
  );
  ok(
    !validateSalePayload({ ...roundedSale, rounding: { mode: "nearest", adjustmentMinor: 0, dueMinor: 2926 } }).ok,
    "zero adjustment refused — omit the block instead",
  );
  ok(
    !validateSalePayload({ ...roundedSale, rounding: { mode: "nearest", adjustmentMinor: -1, dueMinor: 2926 } }).ok,
    "due not on the nickel refused",
  );
  ok(
    !validateSalePayload({ ...roundedSale, rounding: { mode: "nearest", adjustmentMinor: -6, dueMinor: 2920 } }).ok,
    "adjustment beyond ±4¢ refused",
  );
  ok(
    !validateSalePayload({ ...roundedSale, rounding: { mode: "nearest", adjustmentMinor: 4, dueMinor: 2925 } }).ok,
    "incoherent due (≠ total + adjustment) refused",
  );
  ok(
    !validateSalePayload({
      ...roundedSale,
      rounding: { mode: "up", adjustmentMinor: -1, dueMinor: 2925 },
    }).ok,
    "mode up cannot round down",
  );
  ok(
    !validateSalePayload({
      ...roundedSale,
      rounding: { mode: "down", adjustmentMinor: 4, dueMinor: 2930 },
    }).ok,
    "mode down cannot round up",
  );
  ok(
    !validateSalePayload({
      ...roundedSale,
      rounding: { mode: "off" as unknown as "nearest", adjustmentMinor: -1, dueMinor: 2925 },
    }).ok,
    "mode off cannot ride a rounding block",
  );
  ok(!validateSalePayload({ ...goodSale, drawerSessionId: "till-1" }).ok, "non-uuid drawer session refused");
  ok(!validateSalePayload({ ...goodSale, idVerification: undefined }).ok, "sale without ID gate refused");
  ok(
    !validateSalePayload({ ...goodSale, idVerification: { method: "manual" } }).ok,
    "manual ID without audit event uuid refused",
  );
  ok(
    validateSalePayload({ ...goodSale, idVerification: { method: "manual", manualEventUuid: U1 } }).ok,
    "manual ID with audit event uuid ok",
  );

  // Override block (POS B24) — optional; complete + markdown-only when present.
  const goodOverride = { originalUnitPriceMinor: 1663, reason: "damaged packaging", approvedByEmployeeId: U4 };
  ok(
    validateSalePayload({ ...goodSale, lines: [{ ...goodSale.lines[0], override: goodOverride }] }).ok,
    "B24: line with a complete override block passes",
  );
  ok(
    !validateSalePayload({
      ...goodSale,
      lines: [{ ...goodSale.lines[0], override: { ...goodOverride, originalUnitPriceMinor: 1463 } }],
    }).ok,
    "B24: override that does not lower the price refused",
  );
  ok(
    !validateSalePayload({
      ...goodSale,
      lines: [{ ...goodSale.lines[0], override: { ...goodOverride, reason: "x" } }],
    }).ok,
    "B24: override with a short reason refused",
  );
  ok(
    !validateSalePayload({
      ...goodSale,
      lines: [{ ...goodSale.lines[0], override: { ...goodOverride, approvedByEmployeeId: "mgr-1" } }],
    }).ok,
    "B24: override without a manager employee id refused",
  );
  ok(
    !validateSalePayload({
      ...goodSale,
      lines: [{ ...goodSale.lines[0], override: { ...goodOverride, originalUnitPriceMinor: 16.63 as unknown as number } }],
    }).ok,
    "B24: override with non-integer money refused",
  );
  ok(
    !validateSalePayload({
      ...goodSale,
      lines: [{ ...goodSale.lines[0], quantity: 0 }],
    }).ok,
    "zero quantity refused",
  );
  ok(
    !validateSalePayload({
      ...goodSale,
      lines: [{ ...goodSale.lines[0], category: "" }],
    }).ok,
    "missing category snapshot refused",
  );
  // POS B20: variantId is optional — absent OK (pre-B20 queues), present must
  // be non-empty.
  ok(
    validateSalePayload({
      ...goodSale,
      lines: [{ ...goodSale.lines[0], variantId: "var-1" }],
    }).ok,
    "line with variantId ok",
  );
  ok(
    !validateSalePayload({
      ...goodSale,
      lines: [{ ...goodSale.lines[0], variantId: "  " }],
    }).ok,
    "blank variantId refused",
  );

  // Medical block (POS B8) — optional; structurally validated when present.
  const goodMedical = {
    card: {
      upid: "WA-UPID-0001",
      effectiveOn: "2026-01-01",
      expiresOn: "2027-01-01",
      holderType: "patient" as const,
      mcrVerified: true,
    },
    cardEventUuid: U3,
    medicalSavingsMinor: 463,
  };
  ok(
    validateSalePayload({ ...goodSale, totalMinor: 2000, subtotalMinor: 2000, taxMinor: 0, tenderedMinor: 2000, changeMinor: 0, medical: goodMedical }).ok,
    "medical sale with full block ok",
  );
  ok(!validateSalePayload({ ...goodSale, medical: { ...goodMedical, cardEventUuid: "not-a-uuid" } }).ok, "medical without card-capture event uuid refused");
  ok(
    !validateSalePayload({ ...goodSale, medical: { ...goodMedical, card: { ...goodMedical.card, mcrVerified: false } } }).ok,
    "medical without MCR attestation refused",
  );
  ok(
    !validateSalePayload({ ...goodSale, medical: { ...goodMedical, card: { ...goodMedical.card, upid: "x" } } }).ok,
    "medical with bad UPID refused",
  );
  ok(
    !validateSalePayload({ ...goodSale, medical: { ...goodMedical, card: { ...goodMedical.card, holderType: "friend" as "patient" } } }).ok,
    "medical with bad holder type refused",
  );
  ok(
    !validateSalePayload({ ...goodSale, medical: { ...goodMedical, medicalSavingsMinor: -1 } }).ok,
    "medical with negative savings refused",
  );
  ok(
    !validateSalePayload({ ...goodSale, medical: { ...goodMedical, card: undefined as unknown as typeof goodMedical.card } }).ok,
    "medical without card refused",
  );

  // Loyalty block (POS B14) — optional; structurally validated when present.
  ok(
    validateSalePayload({ ...goodSale, loyalty: { customerId: U4, memberLabel: "Jane D." } }).ok,
    "loyalty member attach ok",
  );
  ok(
    !validateSalePayload({ ...goodSale, loyalty: { customerId: "cust-1", memberLabel: "Jane D." } }).ok,
    "loyalty with non-uuid customer refused",
  );
  ok(
    !validateSalePayload({ ...goodSale, loyalty: { customerId: U4, memberLabel: "  " } }).ok,
    "loyalty with blank label refused",
  );
  ok(
    !validateSalePayload({ ...goodSale, loyalty: { customerId: U4, memberLabel: "x".repeat(81) } }).ok,
    "loyalty with over-long label refused",
  );
  ok(
    !validateSalePayload({ ...goodSale, loyalty: "member" as unknown as { customerId: string; memberLabel: string } }).ok,
    "loyalty non-object refused",
  );

  // Task AM-B — loyalty redemption block + per-line reductions.
  const redeemedSale: PosSalePayload = {
    ...goodSale,
    lines: [
      {
        productId: "prod-1", productName: "Blue Dream 3.5g", category: "flower",
        quantity: 2, unitPriceMinor: 1363, regularPriceMinor: 1463, loyaltyDiscountMinor: 100,
      },
    ],
    totalMinor: 2726, subtotalMinor: 1863, taxMinor: 863,
    tenderedMinor: 3000, changeMinor: 274,
    loyaltyRedemption: { redemptionId: U4, code: "GW-7K3M-92QF", appliedMinor: 200 },
  };
  ok(validateSalePayload(redeemedSale).ok, "loyalty redemption sale passes");
  ok(
    !validateSalePayload({
      ...redeemedSale,
      loyaltyRedemption: { redemptionId: U4, code: "GW-7K3M-92QF", appliedMinor: 150 },
    }).ok,
    "appliedMinor mismatching the per-line sum refused",
  );
  ok(
    !validateSalePayload({
      ...redeemedSale,
      loyaltyRedemption: { redemptionId: "not-a-uuid", code: "GW-7K3M-92QF", appliedMinor: 200 },
    }).ok,
    "redemption with non-uuid id refused",
  );
  ok(
    !validateSalePayload({ ...redeemedSale, loyaltyRedemption: undefined }).ok,
    "orphaned per-line loyalty reductions (no block) refused",
  );
  ok(
    !validateSalePayload({
      ...redeemedSale,
      lines: [{ ...redeemedSale.lines[0], loyaltyDiscountMinor: -5 }],
      loyaltyRedemption: { redemptionId: U4, code: "GW-7K3M-92QF", appliedMinor: 200 },
    }).ok,
    "negative per-line loyalty reduction refused",
  );
  ok(
    !validateSalePayload({
      ...redeemedSale,
      loyaltyRedemption: { redemptionId: U4, code: "", appliedMinor: 200 },
    }).ok,
    "blank redemption code refused",
  );

  // Punch payload
  ok(validatePunchPayload({ intent: "in" }).ok, "punch in ok");
  ok(validatePunchPayload({ intent: "out" }).ok, "punch out ok");
  ok(!validatePunchPayload({ intent: "toggle" as "in" }).ok, "blind toggle refused");
  ok(!validatePunchPayload({}).ok, "missing intent refused");

  // No-sale payload
  ok(validateNoSalePayload({ reason: "change fund swap", approvedByEmployeeId: U4 }).ok, "no-sale with reason+approver ok");
  ok(!validateNoSalePayload({ reason: "x", approvedByEmployeeId: U4 }).ok, "short reason refused");
  ok(!validateNoSalePayload({ reason: "valid reason" }).ok, "missing approver refused");

  // Replay ordering
  {
    const evts = [
      { deviceId: U2, sequence: 2, occurredAt: "2026-07-13T10:02:00Z" },
      { deviceId: U1, sequence: 5, occurredAt: "2026-07-13T10:05:00Z" },
      { deviceId: U2, sequence: 1, occurredAt: "2026-07-13T10:01:00Z" },
    ];
    const sorted = sortEventsForReplay(evts);
    ok(
      sorted[0].deviceId === U1 && sorted[1].sequence === 1 && sorted[2].sequence === 2,
      "replay sorts by device then sequence",
    );
  }

  console.log(`pos/sale-event-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`${fail} pos/sale-event-core tests failed`);
}

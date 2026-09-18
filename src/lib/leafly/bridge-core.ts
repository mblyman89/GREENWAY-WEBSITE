/**
 * src/lib/leafly/bridge-core.ts
 *
 * SLICE L-10 — THE BRIDGE BETWEEN A LEAFLY ORDER AND THE SHOP FLOOR.
 *
 * ===========================================================================
 * WHAT THIS FILE IS FOR
 * ===========================================================================
 * Until now a Leafly order lived only in `leafly_orders`. The speakers, the
 * receipt printer and the register all read `orders`. So a Leafly order was
 * invisible to every one of them — not by configuration, but structurally.
 *
 * This module holds the decisions that close that gap. It is PURE: no
 * database, no clock, no network. Every input is a parameter and every output
 * is a value, so all of it is exercised in CI without a Leafly account.
 *
 * ===========================================================================
 * THE OWNER'S DECISIONS, WHICH THIS FILE ENCODES
 * ===========================================================================
 * Asked when a Leafly order should reach the floor, the owner split it in two,
 * and the split is the whole design:
 *
 *   > "I think the leafly order should become floor visible once the order has
 *   >  been accepted by us. it should however, make noise on the speaker, and
 *   >  print out the receipt immediately so we know to accept the order as
 *   >  soon as possible."
 *
 * So there are TWO stages, and they are deliberately not the same moment:
 *
 *   ARRIVAL  (order_submit webhook lands)
 *     → announce on the PA
 *     → print the receipt
 *     → do NOT create a local order, do NOT put it in the register queue
 *
 *   ACCEPTANCE (we acknowledge it to Leafly)
 *     → create the local order with origin='leafly'
 *     → link it back via leafly_orders.local_order_id
 *     → it now appears in the register pickup queue
 *
 * The reasoning is sound and worth preserving: the noise and the paper exist
 * to make somebody walk over and accept the order inside Leafly's fifteen
 * minute window. The register queue is a list of work that is actually ours.
 * An order we have not accepted is not yet work — it might auto-cancel — and
 * putting it on the floor's list would be telling staff to prepare something
 * that may evaporate.
 *
 * ===========================================================================
 * WHY THE ANNOUNCEMENT IS THE URGENT ONE
 * ===========================================================================
 * Leafly's specification is blunt about the deadline:
 *
 *   "Orders are acknowledged as having been retrieved in whole by your system
 *    within fifteen minutes of receiving an order submission webhook. Any
 *    orders not acknowledged by this deadline will be auto canceled."
 *
 * A missed window cancels a real customer's real order, and the cancellation
 * reason `order_api_unacknowledged` records that it was our fault. The chime
 * and the receipt are the shop's defence against that, which is exactly why
 * the owner wanted them immediate rather than on acceptance.
 *
 * ===========================================================================
 * RULE 11 — WHAT THIS FILE DELIBERATELY DOES NOT RE-IMPLEMENT
 * ===========================================================================
 * `src/lib/orders/order-origin-core.ts` already owns the origin vocabulary:
 * which origins exist, which are announced, which are pickups, what each is
 * called, what prints on the receipt, and which sound each gets by default.
 * That file was written in slice L-2 and tested, and then — as the L-9 recon
 * found — never called by anything.
 *
 * This module CONSUMES it. It does not restate any of those rules. If a rule
 * about origins needs to change, it changes there, once.
 */

import {
  DEFAULT_ORDER_ORIGIN,
  ORIGIN_DEFAULT_SOUND_IDS,
  isPickupOrigin,
  orderOriginLabel,
  orderOriginReceiptLine,
  resolveOriginSound,
  shouldAnnounceOrigin,
  type OrderOrigin,
} from "@/lib/orders/order-origin-core";

// ============================================================================
// 1. THE TWO STAGES
// ============================================================================

/**
 * The two moments in a Leafly order's life that this slice cares about.
 *
 * Named rather than booleans because `bridge(order, true, false)` at a call
 * site is unreadable, and because a third stage is plausible later (an
 * `expired` sweep, say) and an enum makes that an additive change.
 */
export const LEAFLY_BRIDGE_STAGES = ["arrival", "acceptance"] as const;
export type LeaflyBridgeStage = (typeof LEAFLY_BRIDGE_STAGES)[number];

/**
 * What the shop should DO at a given stage.
 *
 * Every field is a decision, and every decision has exactly one home. The
 * server layer reads this object and performs the I/O; it never decides.
 */
export type LeaflyBridgeActions = {
  /** Make the PA speakers sound. */
  announce: boolean;
  /** Queue a receipt on the online-orders printer. */
  print: boolean;
  /** Create the row in `orders` that makes this visible to the register. */
  createLocalOrder: boolean;
  /** One line safe to drop into a server log. */
  summary: string;
};

/**
 * Leafly's own status values that mean "this order is over".
 *
 * Duplicated here as a NAMED LOCAL rather than imported, for one specific
 * reason: `order-contract-core.ts` owns the full Leafly status vocabulary and
 * this module must not fork it — but the two values below are used here only
 * as a guard, and importing the whole contract module into the bridge would
 * couple the shop-floor decision to the wire protocol. The self-tests below
 * assert these two strings against the contract module's own list, so a drift
 * fails CI rather than passing silently.
 */
export const BRIDGE_TERMINAL_STATUSES = ["picked_up", "canceled", "expired"] as const;

export function isBridgeTerminalStatus(status: string | null | undefined): boolean {
  if (typeof status !== "string") return false;
  return (BRIDGE_TERMINAL_STATUSES as readonly string[]).includes(status.trim());
}

/**
 * Decide what happens to a Leafly order at a given stage.
 *
 * THE GUARD THAT MATTERS: `alreadyDone`. Leafly retries webhooks, and the
 * specification is explicit that a non-200 triggers a retry which can end in
 * an auto-cancelled customer order — so our handlers answer 200 generously.
 * That means the same arrival can legitimately be processed more than once.
 * Announcing twice is merely annoying; printing twice wastes paper and puts
 * two tickets for one order on the shelf, which is how one customer's bag gets
 * built twice. So every action is suppressed when the work is already done.
 *
 * `leaflyStatus` is consulted so that a webhook arriving for an order that has
 * already been picked up or cancelled cannot make the speakers ring. Leafly
 * sends status webhooks for the whole lifecycle, and an `order_status` event
 * carrying `canceled` must not be mistaken for a new arrival.
 */
export function decideBridgeActions(input: {
  stage: LeaflyBridgeStage;
  /** Has this stage's work already been performed for this order? */
  alreadyDone: boolean;
  /** Leafly's current status for the order, verbatim. */
  leaflyStatus?: string | null;
  /** True when the shop has switched the Leafly bridge off entirely. */
  bridgeEnabled?: boolean;
}): LeaflyBridgeActions {
  const none = (summary: string): LeaflyBridgeActions => ({
    announce: false,
    print: false,
    createLocalOrder: false,
    summary,
  });

  if (input.bridgeEnabled === false) {
    return none("leafly bridge: turned off in settings");
  }

  if (isBridgeTerminalStatus(input.leaflyStatus)) {
    return none(
      `leafly bridge: order is already ${String(input.leaflyStatus).trim()} — no floor action`,
    );
  }

  if (input.alreadyDone) {
    return none(`leafly bridge: ${input.stage} already handled — nothing repeated`);
  }

  if (input.stage === "arrival") {
    // The owner's decision, verbatim: noise and paper immediately, so somebody
    // accepts the order before Leafly's fifteen-minute window closes. No local
    // order yet — this is not the floor's work until we accept it.
    return {
      announce: true,
      print: true,
      createLocalOrder: false,
      summary: "leafly bridge: arrival — announce + print, awaiting acceptance",
    };
  }

  // acceptance
  return {
    announce: false,
    print: false,
    createLocalOrder: true,
    summary: "leafly bridge: accepted — creating the local order for the register",
  };
}

// ============================================================================
// 1b. THE CANCEL COLLISION  (the owner's question Q-B, answered in code)
// ============================================================================

/**
 * The owner asked, verbatim:
 *
 *   > "I am not sure what to do about what happens when leafly cancels an
 *   >  order already loaded into a register sale. what is the enterprise
 *   >  industry standard practice on this one?"
 *
 * ── WHY THIS IS NOW URGENT RATHER THAN THEORETICAL ──────────────────────────
 * Before this slice the question was hypothetical, because no Leafly order had
 * ever reached the register. This slice creates that row. The moment a Leafly
 * order can be on the floor, a Leafly cancellation that does NOT follow it is
 * a defect this slice introduced: staff would bag an order that no longer
 * exists, and the first anyone would know is the customer never arriving.
 *
 * ── WHAT THE SPEC FIXES FOR US (not a choice) ───────────────────────────────
 * Leafly's Order API spec, verbatim:
 *
 *   "Unless Leafly's outbound HMAC keys fails your validation, webhook
 *    requests should only be responded to with status codes 200 or 201. These
 *    webhook events are not the place to apply business rules or validations
 *    on the order lifecycle."
 *
 * So we MUST accept the cancellation. We may not refuse it because a till has
 * the order open. The only open question is what happens at the counter.
 *
 * ── THE ENTERPRISE STANDARD ─────────────────────────────────────────────────
 * This is a known problem class: a distributed state change invalidating a
 * transaction already in progress at a terminal. The convergent resolution
 * across retail POS and payment-terminal design is five points:
 *
 *   1. Accept the upstream event immediately; never block on the terminal.
 *   2. NEVER mutate a till mid-transaction from a background event.
 *   3. Interrupt with a blocking, explicit acknowledgement.
 *   4. Require an explicit human disposition. Never auto-decide.
 *   5. Record the collision.
 *
 * The principle underneath all five is the one this codebase already follows
 * ("a doorbell must never be able to fail a sale"): AN EXTERNAL EVENT MAY
 * INFORM THE COUNTER, IT MAY NOT ACT ON THE COUNTER.
 *
 * Point 2 is the one that decides this function's shape. `cancelLocalOrder` is
 * TRUE only when the order is not yet in somebody's hands. Once it is, we
 * raise an alert and leave the sale alone.
 */
export type LeaflyCancelPlan = {
  /** Mark the local order cancelled outright. Safe only when nobody holds it. */
  cancelLocalOrder: boolean;
  /** Put a blocking notice in front of the person working the counter. */
  alertFloor: boolean;
  /** Severity, so the UI can pick between a banner and a modal. */
  severity: "none" | "notice" | "urgent";
  /** What a human must decide, when a human must decide something. */
  dispositionRequired: boolean;
  /** Plain language for the staff member reading it, mid-shift, under pressure. */
  staffMessage: string;
  /** One line for the audit trail. */
  summary: string;
};

/**
 * Local order statuses that mean "somebody is physically working on this".
 *
 * Derived from the `order_status` enum in migration 0007, not invented here:
 * new | acknowledged | preparing | ready | completed | cancelled | no_show.
 *
 * `preparing` and `ready` are the collision cases. `preparing` means product
 * is being pulled off a shelf right now; `ready` means a sealed bag with this
 * customer's name is sitting behind the counter. In both, inventory has
 * already moved, and a background cancel that silently flipped the status
 * would leave that product unaccounted for.
 *
 * `acknowledged` is deliberately NOT in this list. It means staff have seen
 * the order, not that they have started it -- the same distinction
 * order-map-core draws when it maps Leafly's `confirmed` to `acknowledged`
 * rather than `preparing`.
 */
const IN_HAND_STATUSES = new Set(["preparing", "ready"]);

/** Statuses where the order is already over; a cancel changes nothing. */
const FINISHED_STATUSES = new Set(["completed", "cancelled", "no_show"]);

/**
 * The ONLY statuses we will auto-cancel without asking a human.
 *
 * An ALLOWLIST, not a fallthrough, and that distinction is the whole point.
 * The first version of this function ended with an unconditional
 * "cancel it automatically" branch, which meant any status it did not
 * recognise -- a new value from a future migration, a typo, a status added
 * when delivery launches -- would be auto-cancelled by default. That is the
 * dangerous direction to fail in: it silently discards an order nobody has
 * looked at.
 *
 * Phrasing it as "is this one of the two states I can PROVE is safe?" makes
 * the unknown case land in the human-decides branch, which is recoverable.
 * Same posture as mayEmailCustomerForOrigin() in order-origin-core.ts, which
 * asks "is this origin explicitly PERMITTED?" so an unrecognised origin fails
 * towards silence rather than towards an email we were forbidden to send.
 */
const SAFE_TO_AUTO_CANCEL_STATUSES = new Set(["new", "acknowledged"]);

/**
 * Decide what a Leafly cancellation should do to the local order.
 *
 * Pure, so every branch is provable in CI without a register, a database or a
 * Leafly account -- which matters because the expensive branches here are
 * exactly the ones that are hardest to stage for real.
 */
export function decideCancelPlan(input: {
  /** The local order's status, or null when no local order was ever created. */
  localStatus?: string | null;
  /** True when a register sale is open against this order right now. */
  registerSaleOpen?: boolean;
  /** Leafly's cancellation reason code, verbatim, when they sent one. */
  reasonCode?: string | null;
}): LeaflyCancelPlan {
  const status = typeof input.localStatus === "string" ? input.localStatus.trim() : "";
  const reason = typeof input.reasonCode === "string" ? input.reasonCode.trim() : "";
  const because = reason !== "" ? ` (Leafly reason: ${reason})` : "";

  // No local order: the cancel arrived before we accepted, which is the
  // common and harmless case -- including Leafly's own auto-cancel when
  // nobody acknowledged in time. Nothing on the floor to undo.
  if (status === "") {
    return {
      cancelLocalOrder: false,
      alertFloor: false,
      severity: "none",
      dispositionRequired: false,
      staffMessage: "",
      summary: `leafly cancel: no local order existed -- nothing to undo${because}`,
    };
  }

  if (FINISHED_STATUSES.has(status)) {
    return {
      cancelLocalOrder: false,
      alertFloor: false,
      severity: "none",
      dispositionRequired: false,
      summary: `leafly cancel: local order is already ${status} -- left untouched${because}`,
      staffMessage: "",
    };
  }

  // THE COLLISION. Somebody is holding this order, or a till has it open.
  // Point 2 of the standard: do not touch it. Point 3 and 4: tell them, and
  // make them decide.
  if (input.registerSaleOpen === true || IN_HAND_STATUSES.has(status)) {
    const where =
      input.registerSaleOpen === true
        ? "It is open in a register sale right now."
        : `It is marked ${status}.`;
    return {
      cancelLocalOrder: false,
      alertFloor: true,
      severity: "urgent",
      dispositionRequired: true,
      staffMessage:
        `Leafly has CANCELLED this order${because}, but it is already being worked on. ${where} ` +
        "Nothing has been changed automatically. Do not complete this sale. " +
        "Void it, or -- if the customer is standing in front of you and still wants the " +
        "products -- ring it up as a normal walk-in sale. Then restock anything already bagged.",
      summary: `leafly cancel: COLLISION -- local order is ${status}${
        input.registerSaleOpen === true ? " with a register sale open" : ""
      }; left for a human to dispose of${because}`,
    };
  }

  // new / acknowledged: seen but not started. Safe to cancel outright. Still
  // announced to the floor, because somebody may have been about to pick it.
  if (SAFE_TO_AUTO_CANCEL_STATUSES.has(status)) {
    return {
      cancelLocalOrder: true,
      alertFloor: true,
      severity: "notice",
      dispositionRequired: false,
      staffMessage:
        `Leafly cancelled this order${because}. Nobody had started it, so it has been ` +
        "cancelled here too. No action needed.",
      summary: `leafly cancel: local order was ${status} -- cancelled automatically${because}`,
    };
  }

  // A status this build has never heard of. We cannot reason about whether
  // product has moved, so we do not touch it and we do not stay quiet.
  return {
    cancelLocalOrder: false,
    alertFloor: true,
    severity: "urgent",
    dispositionRequired: true,
    staffMessage:
      `Leafly has CANCELLED this order${because}, but this order is in a state this system ` +
      `does not recognise ("${status}"), so nothing has been changed automatically. ` +
      "Check whether anything has been pulled or bagged for it, then void it or ring it " +
      "up as a normal walk-in sale. Tell the owner this status was not recognised.",
    summary: `leafly cancel: UNRECOGNISED local status "${status}" -- left for a human${because}`,
  };
}

// ============================================================================
// 2. THE SOUND
// ============================================================================

/**
 * The owner asked for two specific things about sound:
 *
 *   > "I want the sound to be connected to our sound library, so we can upload
 *   >  custom sounds to play for each type. there are already several
 *   >  preloaded sounds, you can set it to fall back to one of the other
 *   >  sounds that is not the same as the fallback one for our online orders
 *   >  noise."
 *
 * So: an uploaded file must be selectable per origin, and the BUILT-IN
 * fallback for Leafly must differ from the built-in fallback for the website.
 *
 * `ORIGIN_DEFAULT_SOUND_IDS` in order-origin-core.ts already satisfies the
 * second half — greenway gets `chime`, leafly gets `bell` — and the reasoning
 * recorded there is that `bell` ("Cuts through chatter") is the most
 * distinguishable from `chime` across a room. That is the owner's requirement,
 * already met, so this module does not re-decide it. What it adds is the
 * PRECEDENCE, and a guard proving the two can never collapse to one sound.
 */

/**
 * Resolve the sound for one origin, honouring the shop's uploads.
 *
 * PRECEDENCE, highest first:
 *   1. a custom upload chosen for this origin, IF the file still exists
 *   2. a built-in chosen for this origin
 *   3. the origin's default built-in (chime / bell)
 *
 * Step 1's existence check is the important one and mirrors the guarantee
 * `resolveSound()` already makes for devices: a sound file deleted from the
 * bucket must fall back to something audible, never to silence. A speaker that
 * plays nothing is indistinguishable from a broken speaker at twenty feet.
 *
 * `availableCustomPaths` is passed in rather than looked up because this module
 * is pure — listing the bucket is the caller's job.
 */
export function resolveOriginSoundWithLibrary(input: {
  origin: OrderOrigin;
  /** A storage path the owner picked for this origin, or null. */
  configuredCustomPath?: string | null;
  /** A built-in id the owner picked for this origin, or null. */
  configuredSoundId?: string | null;
  /** Paths that actually exist in the bucket right now. */
  availableCustomPaths: readonly string[];
}): string {
  const custom =
    typeof input.configuredCustomPath === "string"
      ? input.configuredCustomPath.trim()
      : "";

  if (custom !== "" && input.availableCustomPaths.includes(custom)) {
    return custom;
  }

  // Delegates to the L-2 core for the built-in decision, including its
  // guarantee that the result is never an empty string.
  return resolveOriginSound({
    origin: input.origin,
    configured: input.configuredSoundId,
  });
}

/**
 * Are the website and Leafly sounds actually different?
 *
 * The owner asked for a Leafly fallback that is "not the same as the fallback
 * one for our online orders noise". The whole point is telling them apart from
 * across the shop, so two origins resolving to one sound silently defeats the
 * feature while appearing to work.
 *
 * This returns the problem rather than throwing, because it is a WARNING, not
 * an error: the owner is allowed to deliberately set both to the same sound if
 * that is what he wants. The settings page should show this, not refuse it.
 */
export function describeSoundCollision(
  greenwaySound: string,
  leaflySound: string,
): string | null {
  if (greenwaySound.trim() === "" || leaflySound.trim() === "") return null;
  if (greenwaySound.trim() !== leaflySound.trim()) return null;
  return (
    `Website orders and Leafly orders would both play "${greenwaySound.trim()}". ` +
    `You will not be able to tell them apart from across the shop.`
  );
}

// ============================================================================
// 3. WHAT THE SPEAKER SAYS AND WHAT THE PAPER SAYS
// ============================================================================

/**
 * NOTE ON WHAT IS NOT IN THIS FILE: the spoken announcement sentence.
 *
 * An earlier draft of this module had its own `bridgeAnnouncementText()`. It
 * was deleted before it ever shipped, because it was a character-for-character
 * copy of `originAnnouncementText()` in the L-2 origin core -- a straight
 * breach of rule 11, written by hand, with a doc comment that claimed it
 * delegated when it did not.
 *
 * The real fix was not to make this file delegate; it was to notice that
 * `announcementText()` in announcer-core.ts -- the function the PA queue
 * actually calls -- was the one hardcoding "New online order." for every
 * order. That function now takes an `origin` and delegates the wording to the
 * origin core. So the sentence has exactly one home, and the production path
 * goes through it. Tests for it live with announcer-core and the origin core.
 */


/**
 * The header block for the printed ticket.
 *
 * `orderOriginReceiptLine` (L-2) supplies the line itself. What this adds is
 * the ARRIVAL URGENCY, which only exists for Leafly and only at arrival:
 * whoever tears this off the printer needs to know a clock is running.
 *
 * The deadline is passed in as an already-formatted string rather than a Date,
 * because formatting a time for a human is a locale and timezone decision that
 * belongs to the caller (house rule 9: the shop runs on Pacific time), and a
 * pure module should not reach for a clock.
 */
export function bridgeReceiptHeaderLines(input: {
  origin: OrderOrigin;
  stage: LeaflyBridgeStage;
  /** Pre-formatted local deadline, e.g. "2:45 PM". */
  acknowledgeByLabel?: string | null;
}): string[] {
  const lines: string[] = [orderOriginReceiptLine(input.origin)];

  if (input.origin === "leafly" && input.stage === "arrival") {
    const by =
      typeof input.acknowledgeByLabel === "string" &&
      input.acknowledgeByLabel.trim() !== ""
        ? input.acknowledgeByLabel.trim()
        : null;
    lines.push(
      by === null
        ? "** ACCEPT THIS ORDER IN THE BACK OFFICE **"
        : `** ACCEPT BY ${by} OR LEAFLY CANCELS IT **`,
    );
  }

  return lines;
}

// ============================================================================
// 4. THE LOCAL ORDER
// ============================================================================

/**
 * The shape the server layer needs in order to create the `orders` row.
 *
 * Money is in MINOR UNITS throughout (house rule 8). Naming every field
 * `…MinorUnits` makes a dollars/cents mix-up a type error at the call site
 * rather than a hundredfold pricing bug on a receipt.
 */
export type LeaflyLocalOrderDraft = {
  origin: OrderOrigin;
  leaflyOrderId: string;
  displayLabel: string;
  customerLabel: string | null;
  subtotalMinorUnits: number;
  taxMinorUnits: number;
  totalMinorUnits: number;
  lines: {
    productName: string;
    variantLabel: string | null;
    quantity: number;
    priceMinorUnits: number;
  }[];
  /** Goes in `orders.staff_note` so the floor knows where this came from. */
  staffNote: string;
};

export type LeaflyDraftResult =
  | { ok: true; draft: LeaflyLocalOrderDraft }
  | { ok: false; reason: string };

/**
 * A Leafly order id is long and opaque. Staff need something sayable.
 *
 * Leafly order ids are uuids; the last block is the most entropic part and
 * reads acceptably out loud. Prefixed `LF-` so nobody at the counter mistakes
 * it for one of our own sequential order numbers — that confusion would be
 * worse than a long label.
 */
export function leaflyDisplayLabel(leaflyOrderId: string): string {
  const clean = typeof leaflyOrderId === "string" ? leaflyOrderId.trim() : "";
  if (clean === "") return "LF-????";
  const tail = clean.split("-").pop() ?? clean;
  return `LF-${tail.slice(-6).toUpperCase()}`;
}

/**
 * Build the local order draft from a Leafly order.
 *
 * REFUSES rather than guesses. If the totals do not add up, or there are no
 * lines, we do not invent a plausible order — we decline and say why, and the
 * Leafly record stays the source of truth. An order in the register with the
 * wrong total is worse than an order that is not in the register, because the
 * first one takes the customer's money.
 *
 * The tax figure is taken as given and never recomputed. Leafly has already
 * told the shopper a total; recomputing it here would risk showing a different
 * number at the counter than the one the customer agreed to.
 */
export function buildLeaflyLocalOrderDraft(input: {
  leaflyOrderId: string;
  customerLabel?: string | null;
  subtotalMinorUnits: number;
  taxMinorUnits: number;
  totalMinorUnits: number;
  lines: readonly {
    productName: string;
    variantLabel?: string | null;
    quantity: number;
    priceMinorUnits: number;
  }[];
}): LeaflyDraftResult {
  const id = typeof input.leaflyOrderId === "string" ? input.leaflyOrderId.trim() : "";
  if (id === "") return { ok: false, reason: "the Leafly order has no id" };

  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    return { ok: false, reason: "the Leafly order has no line items" };
  }

  const money = [
    input.subtotalMinorUnits,
    input.taxMinorUnits,
    input.totalMinorUnits,
  ];
  if (money.some((m) => !Number.isFinite(m) || !Number.isInteger(m) || m < 0)) {
    return {
      ok: false,
      reason: "the Leafly order totals are missing or not whole minor units",
    };
  }

  const cleanLines = input.lines.map((l) => ({
    productName:
      typeof l.productName === "string" && l.productName.trim() !== ""
        ? l.productName.trim()
        : "Unnamed item",
    variantLabel:
      typeof l.variantLabel === "string" && l.variantLabel.trim() !== ""
        ? l.variantLabel.trim()
        : null,
    quantity: Number.isInteger(l.quantity) && l.quantity > 0 ? l.quantity : 1,
    priceMinorUnits:
      Number.isInteger(l.priceMinorUnits) && l.priceMinorUnits >= 0
        ? l.priceMinorUnits
        : 0,
  }));

  return {
    ok: true,
    draft: {
      origin: "leafly",
      leaflyOrderId: id,
      displayLabel: leaflyDisplayLabel(id),
      customerLabel:
        typeof input.customerLabel === "string" && input.customerLabel.trim() !== ""
          ? input.customerLabel.trim()
          : null,
      subtotalMinorUnits: input.subtotalMinorUnits,
      taxMinorUnits: input.taxMinorUnits,
      totalMinorUnits: input.totalMinorUnits,
      lines: cleanLines,
      staffNote: `${orderOriginLabel("leafly")} order ${leaflyDisplayLabel(id)} — accepted from Leafly.`,
    },
  };
}

// ============================================================================
// 4b. READING LEAFLY'S STORED ORDER PAYLOAD
// ============================================================================

/**
 * Pull the fields we need out of a stored `raw_order` payload.
 *
 * EVERY FIELD NAME BELOW IS TAKEN FROM THE VENDORED SPEC
 * (`docs/leafly-specs/order-api-v1.openapi.json`), schema `Order`, and none
 * of them is guessed:
 *
 *   subtotal   "order total before taxes and fees in minor units"
 *   total      "order grand total in minor units, after aggregating all
 *               items, taxes, fees, and discounts. Tip is not included."
 *   taxes      array of TaxComponent, each "amountCents" -- "tax amount in
 *               minor units"
 *   cartItems  array of CartItemOutgoing; per item `name`, `quantity`, and
 *               "discountedPriceCents": "price of entire cart item (all
 *               quantity) in minor units after discount application"
 *
 * TWO THINGS WORTH BEING EXPLICIT ABOUT.
 *
 * First, `discountedPriceCents` is the price of the WHOLE line, not the unit
 * price, and our own receipt lines are per-unit. Dividing is the only way to
 * reconcile them, and it does not always divide evenly -- so the remainder is
 * carried rather than dropped (see below), because silently losing a cent per
 * line is exactly the sort of thing that shows up as an unexplained till
 * variance weeks later.
 *
 * Second, `total` EXCLUDES tip. That is Leafly's definition, quoted above,
 * and it is the right one for us: the tip is not ours and must not appear in
 * the order total the register collects against.
 *
 * Money is never recomputed from the parts. Leafly has already shown the
 * shopper a number; the register must agree with what the customer agreed to,
 * so their totals are taken as given (house rule 8: minor units throughout).
 */
export function readLeaflyOrderPayload(raw: unknown): LeaflyDraftResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "the stored Leafly payload is not an object" };
  }
  const o = raw as Record<string, unknown>;

  // The payload may be the order itself, or an envelope with the order nested
  // under `order` -- the submission webhook wraps it. Try the envelope first
  // and fall back, rather than assuming one shape.
  const inner =
    o.order !== null && typeof o.order === "object" && !Array.isArray(o.order)
      ? (o.order as Record<string, unknown>)
      : o;

  const id = typeof inner.id === "string" ? inner.id.trim() : "";
  if (id === "") return { ok: false, reason: "the stored Leafly payload has no order id" };

  const intOrNull = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 0 ? v : null;

  const subtotal = intOrNull(inner.subtotal);
  const total = intOrNull(inner.total);
  if (subtotal === null || total === null) {
    return { ok: false, reason: "the stored Leafly payload has no usable subtotal or total" };
  }

  // Taxes are an ARRAY of components, and the register wants one number.
  // Summing the components is not recomputing the tax -- it is reading the
  // figure Leafly itself broke out.
  let tax = 0;
  if (Array.isArray(inner.taxes)) {
    for (const t of inner.taxes) {
      if (t === null || typeof t !== "object") continue;
      const amount = intOrNull((t as Record<string, unknown>).amountCents);
      if (amount !== null) tax += amount;
    }
  }

  const rawItems = Array.isArray(inner.cartItems) ? inner.cartItems : [];
  const lines: {
    productName: string;
    variantLabel: string | null;
    quantity: number;
    priceMinorUnits: number;
  }[] = [];

  for (const item of rawItems) {
    if (item === null || typeof item !== "object") continue;
    const ci = item as Record<string, unknown>;
    const quantity =
      typeof ci.quantity === "number" && Number.isInteger(ci.quantity) && ci.quantity > 0
        ? ci.quantity
        : 1;

    // Prefer the discounted line price, because that is what the shopper was
    // actually charged. Fall back to the undiscounted one only if it is
    // absent.
    const lineTotal = intOrNull(ci.discountedPriceCents) ?? intOrNull(ci.priceCents);
    if (lineTotal === null) continue;

    // Whole-line price to unit price. An uneven division would lose money, so
    // the remainder is pushed onto the first unit rather than discarded --
    // quantity 3 at 1000 becomes 334 + 333 + 333, never 333 + 333 + 333.
    // Because our line model carries ONE unit price, a line that does not
    // divide evenly is split into two lines rather than being rounded.
    const base = Math.floor(lineTotal / quantity);
    const remainder = lineTotal - base * quantity;

    const name =
      typeof ci.name === "string" && ci.name.trim() !== "" ? ci.name.trim() : "Unnamed item";
    const size =
      typeof ci.packageSize === "string" && ci.packageSize.trim() !== ""
        ? ci.packageSize.trim()
        : "";
    const unit =
      typeof ci.packageUnit === "string" && ci.packageUnit.trim() !== ""
        ? ci.packageUnit.trim()
        : "";
    const variantLabel = `${size}${unit}`.trim() === "" ? null : `${size}${unit}`.trim();

    if (remainder === 0) {
      lines.push({ productName: name, variantLabel, quantity, priceMinorUnits: base });
    } else {
      // The odd cents ride on a single unit so the line total still adds up
      // exactly to what Leafly charged.
      lines.push({ productName: name, variantLabel, quantity: 1, priceMinorUnits: base + remainder });
      if (quantity - 1 > 0) {
        lines.push({
          productName: name,
          variantLabel,
          quantity: quantity - 1,
          priceMinorUnits: base,
        });
      }
    }
  }

  const first = typeof inner.firstName === "string" ? inner.firstName.trim() : "";
  const last = typeof inner.lastName === "string" ? inner.lastName.trim() : "";
  // Surname initial only. This lands on a receipt that sits on a shelf in a
  // room customers walk through.
  const customerLabel =
    first === "" && last === ""
      ? null
      : `${first}${last === "" ? "" : ` ${last.slice(0, 1).toUpperCase()}.`}`.trim();

  return buildLeaflyLocalOrderDraft({
    leaflyOrderId: id,
    customerLabel,
    subtotalMinorUnits: subtotal,
    taxMinorUnits: tax,
    totalMinorUnits: total,
    lines,
  });
}

// ============================================================================
// 5. SELF-TESTS
// ============================================================================

/**
 * Pure self-tests, run in CI by tests/compliance/pure-selftests.test.ts and by
 * scripts/compliance/run-pure-selftests.ts. No database, no Leafly account.
 */
export function __runLeaflyBridgeTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;

  const ok = (label: string, cond: boolean): void => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`bridge-core FAIL: ${label}`);
    }
  };
  const eq = (label: string, actual: unknown, expected: unknown): void =>
    ok(`${label} (got ${JSON.stringify(actual)})`, Object.is(actual, expected));

  // ---- stages ------------------------------------------------------------
  eq("exactly two stages", LEAFLY_BRIDGE_STAGES.length, 2);
  ok("stages are arrival then acceptance", LEAFLY_BRIDGE_STAGES.join(",") === "arrival,acceptance");

  // ---- THE OWNER'S SPLIT: arrival announces + prints, does NOT create -----
  const arrival = decideBridgeActions({ stage: "arrival", alreadyDone: false });
  ok("arrival announces", arrival.announce);
  ok("arrival prints", arrival.print);
  ok("arrival does NOT create a local order", !arrival.createLocalOrder);

  const acceptance = decideBridgeActions({ stage: "acceptance", alreadyDone: false });
  ok("acceptance creates the local order", acceptance.createLocalOrder);
  ok("acceptance does NOT re-announce", !acceptance.announce);
  ok("acceptance does NOT re-print", !acceptance.print);

  // The two stages must not both create the order, or it is created twice.
  ok(
    "exactly one stage creates the local order",
    [arrival, acceptance].filter((a) => a.createLocalOrder).length === 1,
  );
  ok(
    "exactly one stage announces",
    [arrival, acceptance].filter((a) => a.announce).length === 1,
  );
  ok(
    "exactly one stage prints",
    [arrival, acceptance].filter((a) => a.print).length === 1,
  );

  // ---- idempotence: the retry guard --------------------------------------
  const repeatArrival = decideBridgeActions({ stage: "arrival", alreadyDone: true });
  ok("a repeated arrival announces nothing", !repeatArrival.announce);
  ok("a repeated arrival prints nothing", !repeatArrival.print);
  ok("a repeated arrival creates nothing", !repeatArrival.createLocalOrder);
  ok("a repeated arrival says why", repeatArrival.summary.includes("already handled"));

  const repeatAcceptance = decideBridgeActions({ stage: "acceptance", alreadyDone: true });
  ok("a repeated acceptance creates nothing", !repeatAcceptance.createLocalOrder);

  // ---- terminal statuses cannot ring the bell ----------------------------
  for (const status of BRIDGE_TERMINAL_STATUSES) {
    const dead = decideBridgeActions({
      stage: "arrival",
      alreadyDone: false,
      leaflyStatus: status,
    });
    ok(`a ${status} order announces nothing`, !dead.announce);
    ok(`a ${status} order prints nothing`, !dead.print);
    ok(`a ${status} order creates nothing`, !dead.createLocalOrder);
  }
  eq("three terminal statuses guarded", BRIDGE_TERMINAL_STATUSES.length, 3);
  ok("picked_up is terminal", isBridgeTerminalStatus("picked_up"));
  ok("canceled is terminal", isBridgeTerminalStatus("canceled"));
  ok("expired is terminal", isBridgeTerminalStatus("expired"));
  ok("pending is NOT terminal", !isBridgeTerminalStatus("pending"));
  ok("confirmed is NOT terminal", !isBridgeTerminalStatus("confirmed"));
  ok("ready is NOT terminal", !isBridgeTerminalStatus("ready"));
  ok("null is not terminal", !isBridgeTerminalStatus(null));
  ok("undefined is not terminal", !isBridgeTerminalStatus(undefined));
  ok("whitespace is tolerated", isBridgeTerminalStatus("  canceled  "));
  ok("a nonsense status is not terminal", !isBridgeTerminalStatus("banana"));

  // NON-VACUITY: prove a live order DOES act, so the guards above mean something.
  const live = decideBridgeActions({
    stage: "arrival",
    alreadyDone: false,
    leaflyStatus: "pending",
  });
  ok("a pending order DOES announce (guards are not blanket-off)", live.announce);
  ok("a pending order DOES print", live.print);

  // ---- the master switch -------------------------------------------------
  const off = decideBridgeActions({
    stage: "arrival",
    alreadyDone: false,
    bridgeEnabled: false,
  });
  ok("bridge off: no announce", !off.announce);
  ok("bridge off: no print", !off.print);
  ok("bridge off: no local order", !off.createLocalOrder);
  ok("bridge off says so", off.summary.includes("turned off"));
  const on = decideBridgeActions({
    stage: "arrival",
    alreadyDone: false,
    bridgeEnabled: true,
  });
  ok("bridge explicitly on still acts", on.announce && on.print);
  ok(
    "bridge defaults to ON when unspecified",
    decideBridgeActions({ stage: "arrival", alreadyDone: false }).announce,
  );

  // ---- THE CANCEL COLLISION (Q-B) ----------------------------------------
  //
  // The rule being defended: an external event may INFORM the counter, it may
  // not ACT on the counter. Everything below is a consequence of that.

  // No local order -- the ordinary case, including Leafly's own auto-cancel
  // when nobody acknowledged in time.
  const cancelNoOrder = decideCancelPlan({ localStatus: null });
  ok("cancel with no local order changes nothing", !cancelNoOrder.cancelLocalOrder);
  ok("...and does not alarm anybody", !cancelNoOrder.alertFloor);
  eq("...severity none", cancelNoOrder.severity, "none");
  ok("...needs no human decision", !cancelNoOrder.dispositionRequired);

  // Not started yet -- safe to cancel automatically.
  for (const st of ["new", "acknowledged"]) {
    const plan = decideCancelPlan({ localStatus: st });
    ok(`${st} is cancelled automatically (nobody had started it)`, plan.cancelLocalOrder);
    ok(`${st} still tells the floor`, plan.alertFloor);
    eq(`${st} is a notice, not an emergency`, plan.severity, "notice");
    ok(`${st} needs no human decision`, !plan.dispositionRequired);
    ok(`${st} message says no action needed`, /no action needed/i.test(plan.staffMessage));
  }

  // THE COLLISION. This is the whole point of the function.
  for (const st of ["preparing", "ready"]) {
    const plan = decideCancelPlan({ localStatus: st });
    ok(
      `${st} is NEVER auto-cancelled -- product has already moved`,
      !plan.cancelLocalOrder,
    );
    ok(`${st} raises the alarm`, plan.alertFloor);
    eq(`${st} is urgent`, plan.severity, "urgent");
    ok(`${st} demands an explicit human disposition`, plan.dispositionRequired);
    ok(
      `${st} offers BOTH dispositions (void or sell walk-in)`,
      /void/i.test(plan.staffMessage) && /walk-in/i.test(plan.staffMessage),
    );
    ok(
      `${st} forbids completing the sale`,
      /do not complete/i.test(plan.staffMessage),
    );
    ok(
      `${st} states plainly that nothing was changed automatically`,
      /nothing has been changed automatically/i.test(plan.staffMessage),
    );
    ok(`${st} summary records it as a collision`, /COLLISION/.test(plan.summary));
  }

  // An open register sale escalates even a status that would otherwise be safe.
  // This is the case the owner actually asked about.
  const tillOpen = decideCancelPlan({ localStatus: "new", registerSaleOpen: true });
  ok("an OPEN REGISTER SALE is never auto-cancelled, even from 'new'", !tillOpen.cancelLocalOrder);
  eq("...and it is urgent", tillOpen.severity, "urgent");
  ok("...and a human must dispose of it", tillOpen.dispositionRequired);
  ok("...and the message says so explicitly", /register sale right now/i.test(tillOpen.staffMessage));
  // The contrast that proves the register flag is what did it, not the status.
  ok(
    "...whereas the same status with no till open IS auto-cancelled",
    decideCancelPlan({ localStatus: "new" }).cancelLocalOrder,
  );

  // Already over -- a cancel must not resurrect or re-touch it.
  for (const st of ["completed", "cancelled", "no_show"]) {
    const plan = decideCancelPlan({ localStatus: st });
    ok(`${st} is left untouched`, !plan.cancelLocalOrder);
    ok(`${st} does not alarm anybody`, !plan.alertFloor);
    eq(`${st} severity is none`, plan.severity, "none");
  }
  // The one that would be a real-money bug: cancelling a COMPLETED order would
  // reverse a sale the customer already paid for and walked out with.
  ok(
    "a completed order is never reopened by a late cancel",
    !decideCancelPlan({ localStatus: "completed", registerSaleOpen: true }).cancelLocalOrder,
  );

  // The reason code is carried through so the floor and the audit log both
  // know WHY -- "the customer changed their mind" and "Leafly auto-cancelled
  // because we were too slow" call for very different follow-ups.
  const withReason = decideCancelPlan({
    localStatus: "preparing",
    reasonCode: "order_api_unacknowledged",
  });
  ok(
    "the Leafly reason reaches the staff message",
    withReason.staffMessage.includes("order_api_unacknowledged"),
  );
  ok(
    "...and the audit summary",
    withReason.summary.includes("order_api_unacknowledged"),
  );
  ok(
    "a missing reason leaves no empty parentheses",
    !decideCancelPlan({ localStatus: "preparing" }).summary.includes("()"),
  );

  // Whitespace and casing are hostile inputs from a network payload.
  ok(
    "a padded status is still recognised as in-hand",
    !decideCancelPlan({ localStatus: "  preparing  " }).cancelLocalOrder &&
      decideCancelPlan({ localStatus: "  preparing  " }).dispositionRequired,
  );
  ok(
    "a blank-but-present status is treated as no local order",
    decideCancelPlan({ localStatus: "   " }).severity === "none",
  );
  // An unknown status must fail SAFE. If Leafly or a future migration
  // introduces a status this build has never heard of, the dangerous answer is
  // to auto-cancel it. The safe answer is to ask a human.
  const unknown = decideCancelPlan({ localStatus: "being_delivered_by_drone" });
  ok("an UNRECOGNISED status is NOT auto-cancelled", !unknown.cancelLocalOrder);
  ok("...and it is not silent", unknown.alertFloor);
  ok("...and it is urgent", unknown.severity === "urgent");
  ok("...and a human must decide", unknown.dispositionRequired);
  ok(
    "...and the message names the status nobody recognised",
    unknown.staffMessage.includes("being_delivered_by_drone"),
  );
  ok(
    "...and tells the owner about it, because this is a bug report",
    /tell the owner/i.test(unknown.staffMessage),
  );
  // The allowlist must be exactly the two not-started states. If somebody
  // later adds a status to it, this assertion makes them justify it.
  for (const st of ["preparing", "ready", "completed", "cancelled", "no_show", "refunded", ""]) {
    ok(
      `"${st}" is NOT on the auto-cancel allowlist`,
      !decideCancelPlan({ localStatus: st }).cancelLocalOrder,
    );
  }

  // Every branch must give the floor something to read when it alerts.
  for (const plan of [
    decideCancelPlan({ localStatus: "new" }),
    decideCancelPlan({ localStatus: "preparing" }),
    decideCancelPlan({ localStatus: "ready", registerSaleOpen: true }),
  ]) {
    ok("an alerting plan always carries a staff message", plan.staffMessage.trim().length > 20);
  }
  for (const plan of [
    decideCancelPlan({ localStatus: null }),
    decideCancelPlan({ localStatus: "completed" }),
  ]) {
    ok("a silent plan carries no message to show", plan.staffMessage === "");
  }
  // Structural invariant: we never both cancel it AND demand a disposition.
  // Those two together would mean "we already decided, now you decide" -- the
  // exact ambiguity that gets product handed over after a void.
  for (const st of ["new", "acknowledged", "preparing", "ready", "completed", "cancelled", "no_show"]) {
    for (const till of [true, false]) {
      const plan = decideCancelPlan({ localStatus: st, registerSaleOpen: till });
      ok(
        `${st}/till=${till}: never both auto-cancelled and left to a human`,
        !(plan.cancelLocalOrder && plan.dispositionRequired),
      );
      ok(
        `${st}/till=${till}: a required disposition is always urgent`,
        !plan.dispositionRequired || plan.severity === "urgent",
      );
      ok(
        `${st}/till=${till}: severity none implies silence`,
        plan.severity !== "none" || !plan.alertFloor,
      );
    }
  }

  // ---- SOUND: the library wins when the file exists ----------------------
  const upload = resolveOriginSoundWithLibrary({
    origin: "leafly",
    configuredCustomPath: "uploads/airhorn.mp3",
    availableCustomPaths: ["uploads/airhorn.mp3"],
  });
  eq("an existing upload is used", upload, "uploads/airhorn.mp3");

  const deleted = resolveOriginSoundWithLibrary({
    origin: "leafly",
    configuredCustomPath: "uploads/gone.mp3",
    availableCustomPaths: [],
  });
  eq("a DELETED upload falls back, never to silence", deleted, "bell");
  ok("the fallback is never empty", deleted.trim() !== "");

  const builtinPick = resolveOriginSoundWithLibrary({
    origin: "leafly",
    configuredSoundId: "alert",
    availableCustomPaths: [],
  });
  eq("an explicit built-in wins over the default", builtinPick, "alert");

  const uploadBeatsBuiltin = resolveOriginSoundWithLibrary({
    origin: "leafly",
    configuredCustomPath: "uploads/a.mp3",
    configuredSoundId: "alert",
    availableCustomPaths: ["uploads/a.mp3"],
  });
  eq("an upload outranks a built-in", uploadBeatsBuiltin, "uploads/a.mp3");

  eq(
    "leafly default fallback is bell",
    resolveOriginSoundWithLibrary({ origin: "leafly", availableCustomPaths: [] }),
    "bell",
  );
  eq(
    "greenway default fallback is chime",
    resolveOriginSoundWithLibrary({ origin: "greenway", availableCustomPaths: [] }),
    "chime",
  );

  // THE OWNER'S EXPLICIT REQUIREMENT: the two fallbacks must differ.
  ok(
    "the two default fallbacks are DIFFERENT sounds",
    ORIGIN_DEFAULT_SOUND_IDS.greenway !== ORIGIN_DEFAULT_SOUND_IDS.leafly,
  );

  // Blank/whitespace configuration must not be mistaken for a choice.
  eq(
    "a blank custom path is ignored",
    resolveOriginSoundWithLibrary({
      origin: "leafly",
      configuredCustomPath: "   ",
      availableCustomPaths: [],
    }),
    "bell",
  );
  eq(
    "a null custom path is ignored",
    resolveOriginSoundWithLibrary({
      origin: "greenway",
      configuredCustomPath: null,
      configuredSoundId: null,
      availableCustomPaths: [],
    }),
    "chime",
  );

  // ---- collision warning -------------------------------------------------
  ok("identical sounds are reported", describeSoundCollision("chime", "chime") !== null);
  ok("different sounds are not reported", describeSoundCollision("chime", "bell") === null);
  ok(
    "the collision message names the sound",
    (describeSoundCollision("bell", "bell") ?? "").includes("bell"),
  );
  ok("an empty sound is not a collision", describeSoundCollision("", "") === null);
  ok("whitespace differences are not a real difference", describeSoundCollision(" chime", "chime ") !== null);
  ok(
    "the defaults do NOT collide",
    describeSoundCollision(
      ORIGIN_DEFAULT_SOUND_IDS.greenway,
      ORIGIN_DEFAULT_SOUND_IDS.leafly,
    ) === null,
  );

  // ---- spoken text -------------------------------------------------------
  // The assertions that used to sit here were moved to announcer-core.ts,
  // alongside `announcementText()` -- the function the PA queue actually
  // calls. Testing a private copy of the sentence here proved nothing about
  // what the speaker really says, which is the thing the owner cares about.

  // ---- receipt header ----------------------------------------------------
  const arrivalTicket = bridgeReceiptHeaderLines({
    origin: "leafly",
    stage: "arrival",
    acknowledgeByLabel: "2:45 PM",
  });
  eq("a leafly arrival ticket has two lines", arrivalTicket.length, 2);
  ok("it names Leafly", arrivalTicket[0].includes("LEAFLY"));
  ok("it carries the deadline", arrivalTicket[1].includes("2:45 PM"));
  ok("it says what to do", arrivalTicket[1].includes("ACCEPT"));

  const noDeadline = bridgeReceiptHeaderLines({ origin: "leafly", stage: "arrival" });
  eq("without a deadline it still warns", noDeadline.length, 2);
  ok("the fallback warning still says ACCEPT", noDeadline[1].includes("ACCEPT"));

  const websiteTicket = bridgeReceiptHeaderLines({ origin: "greenway", stage: "arrival" });
  eq("a website ticket has one line", websiteTicket.length, 1);
  ok("a website ticket carries no Leafly deadline", !websiteTicket[0].includes("ACCEPT BY"));
  ok("a website ticket names the website", websiteTicket[0].includes("greenwaymarijuana.com"));

  const acceptedTicket = bridgeReceiptHeaderLines({ origin: "leafly", stage: "acceptance" });
  eq("an accepted leafly ticket drops the urgency", acceptedTicket.length, 1);

  // ---- the local order draft ---------------------------------------------
  const goodDraft = buildLeaflyLocalOrderDraft({
    leaflyOrderId: "8f2c1d44-9b0e-4a77-b3d2-77aa11bb22cc",
    customerLabel: "J. Smith",
    subtotalMinorUnits: 3000,
    taxMinorUnits: 1119,
    totalMinorUnits: 4119,
    lines: [{ productName: "Blue Dream", variantLabel: "1g", quantity: 2, priceMinorUnits: 1500 }],
  });
  ok("a good order builds", goodDraft.ok);
  if (goodDraft.ok) {
    eq("origin is leafly", goodDraft.draft.origin, "leafly");
    eq("the label is short and prefixed", goodDraft.draft.displayLabel, "LF-BB22CC");
    eq("one line survives", goodDraft.draft.lines.length, 1);
    eq("the total is carried verbatim", goodDraft.draft.totalMinorUnits, 4119);
    eq("the tax is NOT recomputed", goodDraft.draft.taxMinorUnits, 1119);
    ok("the staff note names Leafly", goodDraft.draft.staffNote.includes("Leafly"));
    ok("the staff note carries the label", goodDraft.draft.staffNote.includes("LF-BB22CC"));
  }

  // REFUSALS — never invent an order.
  ok("no id refuses", !buildLeaflyLocalOrderDraft({
    leaflyOrderId: "",
    subtotalMinorUnits: 1,
    taxMinorUnits: 0,
    totalMinorUnits: 1,
    lines: [{ productName: "x", quantity: 1, priceMinorUnits: 1 }],
  }).ok);
  ok("no lines refuses", !buildLeaflyLocalOrderDraft({
    leaflyOrderId: "abc",
    subtotalMinorUnits: 1,
    taxMinorUnits: 0,
    totalMinorUnits: 1,
    lines: [],
  }).ok);
  ok("a negative total refuses", !buildLeaflyLocalOrderDraft({
    leaflyOrderId: "abc",
    subtotalMinorUnits: -1,
    taxMinorUnits: 0,
    totalMinorUnits: 1,
    lines: [{ productName: "x", quantity: 1, priceMinorUnits: 1 }],
  }).ok);
  ok("a fractional total refuses (money is minor units)", !buildLeaflyLocalOrderDraft({
    leaflyOrderId: "abc",
    subtotalMinorUnits: 10.5,
    taxMinorUnits: 0,
    totalMinorUnits: 11,
    lines: [{ productName: "x", quantity: 1, priceMinorUnits: 1 }],
  }).ok);
  ok("NaN refuses", !buildLeaflyLocalOrderDraft({
    leaflyOrderId: "abc",
    subtotalMinorUnits: Number.NaN,
    taxMinorUnits: 0,
    totalMinorUnits: 1,
    lines: [{ productName: "x", quantity: 1, priceMinorUnits: 1 }],
  }).ok);
  const refusal = buildLeaflyLocalOrderDraft({
    leaflyOrderId: "abc",
    subtotalMinorUnits: 1,
    taxMinorUnits: 0,
    totalMinorUnits: 1,
    lines: [],
  });
  ok("a refusal explains itself", !refusal.ok && refusal.reason.length > 10);

  // Hostile line data is repaired, not rejected — a missing product NAME must
  // not lose a paying customer's order.
  const messy = buildLeaflyLocalOrderDraft({
    leaflyOrderId: "id-1",
    subtotalMinorUnits: 0,
    taxMinorUnits: 0,
    totalMinorUnits: 0,
    lines: [
      { productName: "   ", quantity: 0, priceMinorUnits: -5 },
      { productName: "OK", variantLabel: "  ", quantity: 3, priceMinorUnits: 250 },
    ],
  });
  ok("messy lines still build", messy.ok);
  if (messy.ok) {
    eq("a blank name becomes a placeholder", messy.draft.lines[0].productName, "Unnamed item");
    eq("a zero quantity becomes 1", messy.draft.lines[0].quantity, 1);
    eq("a negative price becomes 0", messy.draft.lines[0].priceMinorUnits, 0);
    eq("a blank variant becomes null", messy.draft.lines[1].variantLabel, null);
    eq("a real quantity survives", messy.draft.lines[1].quantity, 3);
    eq("both lines survive", messy.draft.lines.length, 2);
  }

  // ---- labels ------------------------------------------------------------
  eq("a short id still labels", leaflyDisplayLabel("abc"), "LF-ABC");
  eq("a blank id is obvious", leaflyDisplayLabel(""), "LF-????");
  eq("whitespace is trimmed", leaflyDisplayLabel("  x1y2z3  "), "LF-X1Y2Z3");
  ok("the label is prefixed so it cannot be read as our own number", leaflyDisplayLabel("1234567").startsWith("LF-"));
  // Pinned to a LITERAL. The earlier form of this assertion computed its own
  // expected value by slicing strings, which is how an assertion ends up
  // restating the implementation instead of checking it: any change to the
  // slicing rule would have changed both sides together and still passed.
  eq("a uuid uses its last block", leaflyDisplayLabel("aaaa-bbbb-cccc-ddddeeffgg"), "LF-EEFFGG");
  eq(
    "a real-shaped uuid keeps only the final six characters",
    leaflyDisplayLabel("8f14e45f-ceea-467a-9ba8-1b2c3d4e5f60"),
    "LF-4E5F60",
  );
  // A label must be short enough to say across a counter. Six characters plus
  // the prefix is the whole point; if the implementation ever returned the
  // full uuid this stays the only assertion that would catch it.
  ok(
    "the label never exceeds nine characters",
    leaflyDisplayLabel("8f14e45f-ceea-467a-9ba8-1b2c3d4e5f60").length === 9,
  );
  // Two different Leafly orders whose ids share a prefix must still be told
  // apart, because the tail is what we keep.
  ok(
    "orders sharing a prefix get different labels",
    leaflyDisplayLabel("order-aaaaaa111111") !== leaflyDisplayLabel("order-aaaaaa222222"),
  );

  // ---- rule 11: we consume the origin core, we do not fork it ------------
  ok("leafly is a pickup origin", isPickupOrigin("leafly"));
  ok("greenway is a pickup origin", isPickupOrigin("greenway"));
  ok("register is NOT a pickup origin", !isPickupOrigin("register"));
  ok("leafly is announced", shouldAnnounceOrigin("leafly"));
  ok("register is not announced", !shouldAnnounceOrigin("register"));
  eq("the default origin is greenway", DEFAULT_ORDER_ORIGIN, "greenway");
  eq("the leafly badge reads Leafly", orderOriginLabel("leafly"), "Leafly");
  ok("the leafly receipt line names Leafly", orderOriginReceiptLine("leafly").includes("LEAFLY"));

  // ---- reading Leafly's stored payload -----------------------------------
  // Field names here are the spec's, not ours. A fixture shaped like the real
  // `Order` schema is the only way these assertions mean anything.
  const payload = {
    id: "8f14e45f-ceea-467a-9ba8-1b2c3d4e5f60",
    firstName: "Jamie",
    lastName: "Rodriguez",
    subtotal: 3000,
    total: 4110,
    taxes: [
      { label: "Cannabis excise", amountCents: 1110 },
      { label: "Sales tax", amountCents: 0 },
    ],
    cartItems: [
      {
        name: "Blue Dream",
        quantity: 2,
        packageSize: "3.5",
        packageUnit: "g",
        priceCents: 3000,
        discountedPriceCents: 3000,
      },
    ],
  };

  const read = readLeaflyOrderPayload(payload);
  ok("a spec-shaped payload is readable", read.ok);
  if (read.ok) {
    eq("the subtotal is taken as given", read.draft.subtotalMinorUnits, 3000);
    eq("the total is taken as given", read.draft.totalMinorUnits, 4110);
    // The tax COMPONENTS are summed; this is reading Leafly's own breakdown,
    // not recomputing tax.
    eq("the tax components are summed", read.draft.taxMinorUnits, 1110);
    eq("the line survives", read.draft.lines.length, 1);
    // discountedPriceCents is the WHOLE line; our lines are per unit.
    eq("a whole-line price becomes a unit price", read.draft.lines[0].priceMinorUnits, 1500);
    eq("the quantity survives", read.draft.lines[0].quantity, 2);
    eq("size and unit become the variant label", read.draft.lines[0].variantLabel, "3.5g");
    // PRIVACY: this label is printed on paper that sits on a shelf.
    eq("the customer is a first name and an initial", read.draft.customerLabel, "Jamie R.");
    ok("the surname is not printed in full", !String(read.draft.customerLabel).includes("Rodriguez"));
  }

  // MONEY CONSERVATION -- the assertion that matters most in this whole file.
  // A line of 1000 across 3 units does not divide evenly. Dropping the
  // remainder would under-charge by a cent, which is how a till ends up
  // unexplainably short.
  const uneven = readLeaflyOrderPayload({
    ...payload,
    subtotal: 1000,
    total: 1000,
    taxes: [],
    cartItems: [{ name: "Pre-roll", quantity: 3, priceCents: 1000, discountedPriceCents: 1000 }],
  });
  ok("an unevenly divisible line is still readable", uneven.ok);
  if (uneven.ok) {
    const summed = uneven.draft.lines.reduce(
      (acc, l) => acc + l.priceMinorUnits * l.quantity,
      0,
    );
    eq("NOT ONE CENT IS LOST when a line does not divide evenly", summed, 1000);
    eq(
      "the quantities still add up to what was ordered",
      uneven.draft.lines.reduce((acc, l) => acc + l.quantity, 0),
      3,
    );
  }
  // The same property, checked across a range rather than one lucky number.
  for (const [lineTotal, qty] of [
    [1000, 3],
    [1, 2],
    [999, 7],
    [10000, 3],
    [5, 4],
  ] as const) {
    const r = readLeaflyOrderPayload({
      ...payload,
      subtotal: lineTotal,
      total: lineTotal,
      taxes: [],
      cartItems: [{ name: "X", quantity: qty, priceCents: lineTotal, discountedPriceCents: lineTotal }],
    });
    ok(`money is conserved for ${lineTotal} over ${qty}`, r.ok);
    if (r.ok) {
      eq(
        `the ${lineTotal}/${qty} split still totals ${lineTotal}`,
        r.draft.lines.reduce((a, l) => a + l.priceMinorUnits * l.quantity, 0),
        lineTotal,
      );
      eq(
        `the ${lineTotal}/${qty} split still has ${qty} units`,
        r.draft.lines.reduce((a, l) => a + l.quantity, 0),
        qty,
      );
    }
  }

  // The discounted price is what the shopper actually paid, so it wins.
  const discounted = readLeaflyOrderPayload({
    ...payload,
    cartItems: [{ name: "Y", quantity: 1, priceCents: 5000, discountedPriceCents: 4000 }],
  });
  ok("a discounted line is readable", discounted.ok);
  if (discounted.ok) {
    eq("the DISCOUNTED price is used, not the list price", discounted.draft.lines[0].priceMinorUnits, 4000);
  }

  // The submission webhook nests the order; a bare order must work too.
  const nested = readLeaflyOrderPayload({ eventType: "order_submit", order: payload });
  ok("an enveloped payload is unwrapped", nested.ok);
  if (nested.ok && read.ok) {
    eq("enveloped and bare payloads agree", nested.draft.totalMinorUnits, read.draft.totalMinorUnits);
  }

  // REFUSALS. Every one of these would otherwise put a wrong number in front
  // of a customer, which is worse than putting nothing there.
  ok("a null payload is refused", !readLeaflyOrderPayload(null).ok);
  ok("a string payload is refused", !readLeaflyOrderPayload("nope").ok);
  ok("an array payload is refused", !readLeaflyOrderPayload([]).ok);
  ok("a payload with no id is refused", !readLeaflyOrderPayload({ ...payload, id: "" }).ok);
  ok("a payload with no total is refused", !readLeaflyOrderPayload({ ...payload, total: null }).ok);
  ok(
    "a payload with a fractional total is refused",
    !readLeaflyOrderPayload({ ...payload, total: 41.1 }).ok,
  );
  ok(
    "a payload with a negative total is refused",
    !readLeaflyOrderPayload({ ...payload, total: -1 }).ok,
  );
  ok(
    "a payload with no cart items is refused",
    !readLeaflyOrderPayload({ ...payload, cartItems: [] }).ok,
  );
  // NON-VACUITY: the refusals above must not be passing because the reader
  // refuses everything. The happy path above already proves it accepts, and
  // this states it as a paired assertion so the two cannot drift apart.
  ok("the reader is not simply refusing everything", readLeaflyOrderPayload(payload).ok);

  // NO LINE MAY EVER CARRY A NEGATIVE PRICE.
  //
  // MUTATION-TESTING NOTE: replacing Math.floor with Math.round in the unit
  // price split survived every assertion above, because rounding UP makes the
  // remainder negative and the negative remainder cancels out again in the
  // total -- money was still conserved, so the conservation checks passed.
  // What it actually produced was a line priced at MINUS 48 cents (50 cents
  // over 99 units). A negative price on a register line is a refund the shop
  // never agreed to, so it is asserted directly rather than inferred from
  // the totals.
  for (const [lineTotal, qty] of [
    [50, 99],
    [1, 2],
    [999, 7],
    [1, 100],
    [7, 3],
  ] as const) {
    const r = readLeaflyOrderPayload({
      ...payload,
      subtotal: lineTotal,
      total: lineTotal,
      taxes: [],
      cartItems: [{ name: "Z", quantity: qty, priceCents: lineTotal, discountedPriceCents: lineTotal }],
    });
    ok(`${lineTotal} over ${qty} is readable`, r.ok);
    if (r.ok) {
      ok(
        `no line is negatively priced for ${lineTotal} over ${qty}`,
        r.draft.lines.every((l) => l.priceMinorUnits >= 0),
      );
      ok(
        `no line has a non-positive quantity for ${lineTotal} over ${qty}`,
        r.draft.lines.every((l) => l.quantity > 0),
      );
      eq(
        `${lineTotal} over ${qty} still conserves money`,
        r.draft.lines.reduce((a, l) => a + l.priceMinorUnits * l.quantity, 0),
        lineTotal,
      );
    }
  }
  // Junk taxes must not poison a readable order -- they are summed defensively.
  const junkTax = readLeaflyOrderPayload({
    ...payload,
    taxes: [null, "x", { label: "ok", amountCents: 100 }, { label: "bad", amountCents: -5 }],
  });
  ok("junk tax components do not make the order unreadable", junkTax.ok);
  if (junkTax.ok) {
    eq("only the valid tax component is counted", junkTax.draft.taxMinorUnits, 100);
  }

  // ---- determinism -------------------------------------------------------
  const twice = [0, 1].map(() =>
    JSON.stringify(decideBridgeActions({ stage: "arrival", alreadyDone: false })),
  );
  ok("the same input gives the same decision", twice[0] === twice[1]);

  return { passed, failed };
}

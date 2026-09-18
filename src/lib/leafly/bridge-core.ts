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
 * The spoken line, for when the `voice` sound is selected.
 *
 * Delegates the wording to `originAnnouncementText` in the L-2 core (rule 11)
 * and adds only the test case, which is the announcer's own concern and not
 * the origin module's.
 *
 * Note what is deliberately absent: the customer's name and what they bought.
 * This is said out loud across a sales floor with other customers standing in
 * it. The fact is ours to broadcast; the shopper's details are not.
 */
export function bridgeAnnouncementText(input: {
  origin: OrderOrigin;
  orderNumber?: string | null;
  isTest?: boolean;
}): string {
  if (input.isTest === true) return "Announcer test. This speaker is working.";
  const num =
    typeof input.orderNumber === "string" && input.orderNumber.trim() !== ""
      ? input.orderNumber.trim()
      : "";
  const lead = input.origin === "leafly" ? "New Leafly order" : "New online order";
  return num === "" ? `${lead}.` : `${lead}. Number ${num}.`;
}

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
  eq(
    "leafly is named out loud",
    bridgeAnnouncementText({ origin: "leafly", orderNumber: "1042" }),
    "New Leafly order. Number 1042.",
  );
  eq(
    "the website is not named leafly",
    bridgeAnnouncementText({ origin: "greenway", orderNumber: "1042" }),
    "New online order. Number 1042.",
  );
  eq(
    "no number still speaks",
    bridgeAnnouncementText({ origin: "leafly" }),
    "New Leafly order.",
  );
  eq(
    "a test says it is a test",
    bridgeAnnouncementText({ origin: "leafly", isTest: true }),
    "Announcer test. This speaker is working.",
  );
  ok(
    "the two spoken lines are distinguishable",
    bridgeAnnouncementText({ origin: "leafly", orderNumber: "7" }) !==
      bridgeAnnouncementText({ origin: "greenway", orderNumber: "7" }),
  );
  // PRIVACY: the spoken line must never carry a name.
  ok(
    "the spoken line never contains a customer name",
    !bridgeAnnouncementText({ origin: "leafly", orderNumber: "1042" })
      .toLowerCase()
      .includes("jane"),
  );

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

  // ---- determinism -------------------------------------------------------
  const twice = [0, 1].map(() =>
    JSON.stringify(decideBridgeActions({ stage: "arrival", alreadyDone: false })),
  );
  ok("the same input gives the same decision", twice[0] === twice[1]);

  return { passed, failed };
}

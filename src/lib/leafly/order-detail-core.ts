/**
 * src/lib/leafly/order-detail-core.ts
 *
 * SLICE L-24 — "open the order and read what you need FIRST", except there
 * was no way to open the order.
 *
 * ===========================================================================
 * THE REPORT
 * ===========================================================================
 * The owner, looking at the Accept button:
 *
 *   > "Before acknowledging the order, there is a warning text below the
 *   >  order that says once acknowledged 'it permanently ends your access to
 *   >  the customers id images - so open the order and read what you need
 *   >  FIRST.' But there is no way to click the order and see the order
 *   >  details, or customer id image, I'm not sure what that is or means."
 *
 * He is right, and the warning is ours: `order-ack-core.ts` builds it as the
 * acknowledge action's hint. It was accurate about the CONSEQUENCE and it
 * instructed him to do something the product had never built. A warning that
 * tells someone to take a precaution that does not exist is worse than no
 * warning, because it reads as a reassurance that the precaution is there.
 *
 * ===========================================================================
 * WHAT THE AUTHORITATIVE SPEC ACTUALLY SAYS
 * ===========================================================================
 * Vendored at docs/leafly-specs/order-api-v1.openapi.json. Two endpoints have
 * existed the whole time and this codebase had never called either:
 *
 *   GET /{order_integration_key}/government_id/{id}   -> 200 image/* binary
 *   GET /{order_integration_key}/medical_id/{id}      -> 200 image/* binary
 *
 * Their descriptions are identical and unambiguous, VERBATIM:
 *
 *   "Fetch the binary representing the government id image the customer
 *    submitted with their order. This endpoint is only usable prior to order
 *    acknowledgement and only when the order is in pending status."
 *
 * And in the API-wide Limitations section, VERBATIM:
 *
 *   "Media associated with an order (e.g., government and medical id images)
 *    are only accessible before order acknowledgement and when the order is
 *    in pending status."
 *
 * The certification table lists both as *Recommended*, with the value add:
 *
 *   Retrieve Government ID Image — "Safety enhancement for retailers without
 *                                   needing to view LeaflyBiz"
 *   Retrieve Medical ID Image    — "Compliance enhancement for retailers
 *                                   without needing to view LeaflyBiz"
 *
 * That last phrase is the point of this slice. Without these, checking a
 * shopper's ID means leaving our back office and logging into LeaflyBiz — and
 * Leafly's own read-only-dashboard note means that is exactly the round trip
 * the integration is supposed to remove.
 *
 * ===========================================================================
 * THE TWO CONDITIONS, AND WHY THEY ARE **AND** AND NOT **OR**
 * ===========================================================================
 * "only usable prior to order acknowledgement" AND "only when the order is in
 * pending status" are two separate gates, and an order can fail either one
 * independently:
 *
 *   * acknowledged, still pending   -> media revoked (acknowledgement did it)
 *   * not acknowledged, canceled    -> media gone (status left pending)
 *
 * Encoding this as `AND` rather than a single "is it acknowledged" check is
 * what stops the second case from rendering a broken image with no
 * explanation. That case is REAL: Leafly auto-cancels an unacknowledged order
 * after fifteen minutes, so an order sitting on the board past the deadline is
 * unacknowledged AND non-pending at the same time.
 *
 * ===========================================================================
 * WHY THE VERDICT IS COMPUTED HERE AND NOT IN THE COMPONENT
 * ===========================================================================
 * Because the interesting part is not "can we show the image", it is "what do
 * we tell the person who expected to see one". Four different reasons produce
 * a missing image and each needs a different sentence:
 *
 *   ready            -> show it
 *   already_acked    -> the door is closed, and it was US who closed it
 *   not_pending      -> Leafly moved the order on; nothing we did
 *   no_order_id      -> we never had an id to ask with (a fault, not a state)
 *
 * A component that computed this inline would end up with one "not available"
 * string covering all four, which is precisely the ambiguity that produced
 * the owner's "I'm not sure what that is or means".
 *
 * Pure: no I/O, no clock, no imports with side effects. House rule 5.
 */

// ---------------------------------------------------------------------------
// 1. THE MEDIA KINDS
// ---------------------------------------------------------------------------

/**
 * The two media endpoints the spec exposes. Named as a closed list so a typo
 * is a compile error and so the route, the fetcher and the UI cannot disagree
 * about which strings are legal.
 */
export const LEAFLY_MEDIA_KINDS = ["government_id", "medical_id"] as const;
export type LeaflyMediaKind = (typeof LEAFLY_MEDIA_KINDS)[number];

/**
 * The URL path segment for each kind.
 *
 * This is a MAP and not `kind` used directly, even though the two currently
 * have identical values. The path segment is Leafly's wire format and the
 * kind is our internal vocabulary; collapsing them would mean a future
 * rename on either side silently breaks the other. One line of indirection
 * buys that separation permanently.
 */
const MEDIA_PATH_SEGMENT: Readonly<Record<LeaflyMediaKind, string>> = {
  government_id: "government_id",
  medical_id: "medical_id",
};

/** Human wording, for screens and for log lines. */
export const MEDIA_KIND_LABEL: Readonly<Record<LeaflyMediaKind, string>> = {
  government_id: "Government ID",
  medical_id: "Medical card",
};

/**
 * Is this string one of the two kinds?
 *
 * Used by the image route to validate a path parameter that arrives from a
 * URL. Written as a guard rather than a cast so an unexpected value becomes a
 * 400 instead of being interpolated straight into a request to Leafly.
 */
export function isLeaflyMediaKind(value: unknown): value is LeaflyMediaKind {
  return typeof value === "string" && (LEAFLY_MEDIA_KINDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// 2. THE ACCESS RULE
// ---------------------------------------------------------------------------

/**
 * Why the ID images can or cannot be fetched right now.
 *
 * `ready` is the only value that permits a call. Every other value is a
 * REASON, because the caller's real question is "what do I tell the operator".
 */
export type MediaAccessCode =
  | "ready"
  | "already_acknowledged"
  | "not_pending"
  | "no_order_id";

export type MediaAccessVerdict = {
  /** May we call Leafly's media endpoints for this order? */
  allowed: boolean;
  code: MediaAccessCode;
  /**
   * What to show the operator. Written for someone standing at a counter with
   * a customer in front of them, not for a developer reading a stack trace.
   */
  message: string;
  /**
   * True when the window is closed FOREVER for this order, as opposed to
   * merely not open. Drives whether the UI offers a retry, and — more
   * importantly — stops us implying a refresh might help when it cannot.
   */
  permanentlyClosed: boolean;
};

/**
 * Leafly's `pending` status, spelled once.
 *
 * The media rule keys off this exact string, and `order-ack-core` already
 * treats `pending` as the pre-acknowledgement state. Declared as a constant
 * here (rather than re-deriving a list of "non-pending" statuses) because the
 * spec's condition is stated positively — "only when the order is in pending
 * status" — and inverting a positive rule into a denylist is how a new Leafly
 * status silently gains access it was never granted.
 */
export const LEAFLY_MEDIA_REQUIRED_STATUS = "pending";

/**
 * Decide whether the customer's ID images are reachable.
 *
 * Both spec conditions are checked, and the ORDER of the checks is chosen to
 * produce the most useful sentence when more than one is true at once. An
 * order that is acknowledged AND no longer pending reports the
 * acknowledgement, because that is the one a human did on purpose and the one
 * they can learn from. Reporting "not pending" there would be true and
 * useless — it describes a consequence and hides the cause.
 */
export function decideMediaAccess(input: {
  leaflyOrderId?: string | null;
  acknowledgedAt?: string | null;
  leaflyStatus?: string | null;
}): MediaAccessVerdict {
  const id = typeof input.leaflyOrderId === "string" ? input.leaflyOrderId.trim() : "";
  if (id === "") {
    return {
      allowed: false,
      code: "no_order_id",
      message:
        "This order has no Leafly order number recorded, so there is nothing to look up. " +
        "That is a fault on our side rather than a closed window — the order should be " +
        "reported to the owner.",
      // NOT permanent: a repaired row would have an id. Calling this permanent
      // would tell the operator to give up on a recoverable data problem.
      permanentlyClosed: false,
    };
  }

  const acked = typeof input.acknowledgedAt === "string" && input.acknowledgedAt.trim() !== "";
  if (acked) {
    return {
      allowed: false,
      code: "already_acknowledged",
      message:
        "This order has already been acknowledged, and acknowledging permanently ends " +
        "access to the customer's ID images. Leafly does not allow them to be fetched " +
        "again. Check the customer's physical ID at the counter as normal.",
      permanentlyClosed: true,
    };
  }

  const status = typeof input.leaflyStatus === "string" ? input.leaflyStatus.trim().toLowerCase() : "";
  if (status !== LEAFLY_MEDIA_REQUIRED_STATUS) {
    return {
      allowed: false,
      code: "not_pending",
      message:
        `Leafly only releases ID images while an order is pending, and this order is ` +
        `${status === "" ? "in an unknown state" : `now "${status}"`}. Nothing was done ` +
        `wrong here — Leafly moved the order on. Check the customer's physical ID at the ` +
        `counter as normal.`,
      permanentlyClosed: true,
    };
  }

  return {
    allowed: true,
    code: "ready",
    message:
      "The customer's ID images can be viewed now. Acknowledging this order will end " +
      "that access permanently, so read anything you need first.",
    permanentlyClosed: false,
  };
}

/**
 * Build a media URL.
 *
 * Note the shape: `/{key}/government_id/{id}`, NOT `/{key}/orders/{id}/...`.
 * The media endpoints sit at the ROOT of the order-integration namespace, not
 * under `orders`. Getting that wrong yields a 404, which reads as "Leafly does
 * not have this order" rather than "we asked the wrong path" — a wrong answer
 * that is easy to act on incorrectly, exactly like the base-URL trap that
 * `leaflyOrderApiBaseUrl` exists to prevent.
 *
 * Both segments are percent-encoded for the same reason the acknowledge URL
 * encodes them: the key is owner-entered and the id arrives from a webhook, so
 * neither is ours to trust.
 */
export function leaflyMediaUrl(
  baseUrl: string,
  orderIntegrationKey: string,
  leaflyOrderId: string,
  kind: LeaflyMediaKind,
): string {
  const segment = MEDIA_PATH_SEGMENT[kind];
  return `${baseUrl}/${encodeURIComponent(orderIntegrationKey)}/${segment}/${encodeURIComponent(leaflyOrderId)}`;
}

// ---------------------------------------------------------------------------
// 3. READING THE STORED ORDER PAYLOAD FOR A DETAIL VIEW
// ---------------------------------------------------------------------------

/**
 * A single line of the customer's cart, as a detail view needs it.
 *
 * Quantity and name only, plus money. This is deliberately NOT the full
 * Leafly cart item: the detail view exists so a human can read the order
 * before acknowledging, and the picking flow has its own richer view.
 */
export type DetailCartLine = {
  name: string;
  quantity: number;
  /** Minor units (cents). Null when Leafly did not price the line. */
  lineTotalMinorUnits: number | null;
};

/**
 * Everything the detail view shows, already normalised.
 *
 * Every field is nullable because every field is optional in Leafly's schema
 * for at least one order shape — most sharply for UberEats orders, which the
 * spec says "share a very restricted set of customer details", including
 * "No email address" and a masked `phoneNumber: null`. A detail view that
 * assumed those were present would crash on precisely the order type Leafly
 * warns about.
 */
export type LeaflyOrderDetail = {
  leaflyOrderId: string | null;
  status: string | null;
  marketplace: string | null;
  fulfillmentMechanism: string | null;
  paymentPreference: string | null;

  customerName: string | null;
  dateOfBirth: string | null;
  phoneNumber: string | null;
  emailAddress: string | null;

  medicalStatus: string | null;
  medicalCardNumber: string | null;
  medicalCardState: string | null;
  medicalCardExpiration: string | null;

  lines: DetailCartLine[];
  subtotalMinorUnits: number | null;
  taxesMinorUnits: number | null;
  totalMinorUnits: number | null;

  createdAt: string | null;
};

/** Trim to a string, or null. Never returns an empty string. */
function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t === "" ? null : t;
}

/**
 * Leafly money -> minor units.
 *
 * Leafly sends decimal currency amounts. Everything downstream of here — the
 * orders table, the register, the receipt — is integer minor units, and this
 * repo's house rule is that money never travels as a float.
 *
 * ── WHY THIS IS NOT `Math.round(value * 100)` ────────────────────────────
 * Because that is wrong, and the self-tests below caught it. Multiplying by
 * 100 in binary floating point does not give you the decimal answer:
 *
 *     19.99 * 100 === 1998.9999999999998   (rounds to 1999 — correct by luck)
 *     1.005 * 100 === 100.49999999999999   (rounds to 100 — A CENT IS LOST)
 *
 * The second case rounds DOWN because the product lands just below the .5
 * boundary, even though the true decimal value is exactly 100.5. Any price
 * ending in a half-cent hits this, and half-cents are ordinary once a
 * percentage tax is applied to a cannabis order.
 *
 * So the conversion is done on the DECIMAL TEXT instead of on the binary
 * value. JavaScript prints a number using the shortest representation that
 * round-trips, so `String(1.005)` is exactly `"1.005"` — the digits the
 * sender meant. Shifting the decimal point by string surgery is therefore
 * exact, and the only rounding left is the deliberate half-up on the third
 * decimal place.
 *
 * Returns null rather than 0 for anything unreadable. A missing total and a
 * genuinely free item are different facts, and showing "$0.00" for the first
 * one is how a staff member hands over a bag without taking money.
 */
/**
 * Read a money field that Leafly ALREADY sends in minor units.
 *
 * ===========================================================================
 * WHY THIS EXISTS ALONGSIDE `toMinorUnits`
 * ===========================================================================
 * Because they solve opposite problems, and using the wrong one multiplies
 * every price on the screen by a hundred.
 *
 * `toMinorUnits` converts a DECIMAL CURRENCY AMOUNT ("19.99") into cents. It
 * is careful, correct, and well tested. It is also the wrong tool for an
 * Order payload, because Leafly does not send decimals there.
 *
 * ── THE SPEC, VERBATIM (docs/leafly-specs/order-api-v1.openapi.json) ──────
 *   Order.subtotal            "order total before taxes and fees in minor units"
 *   Order.total               "order grand total in minor units, ..."
 *   Order.deliveryFee         "order delivery fee in minor units..."
 *   Order.totalDiscounts      "total of discounts applied to the order in minor units"
 *   TaxComponent.amountCents  "tax amount in minor units"
 *   CartItemOutgoing.priceCents / .discountedPriceCents / .packagePrice
 *                             "...in minor units"
 *
 * Every money field on an Order is already cents.
 *
 * ── THE DEFECT THIS FIXES, MEASURED ──────────────────────────────────────
 * `scripts/recon/detail-money-probe.ts`, against a spec-shaped $48.03 order:
 *
 *   Subtotal: $4,000.00   (truth: $40.00)
 *   Taxes:    —           (truth: $8.03)
 *   Total:    $4,803.00   (truth: $48.03)
 *   Line:     —           (truth: $40.00)
 *
 * Found by a CONTROL assertion in the blank-detail regression test, which
 * expected 4803 and got 480300. The control existed to prove the reader was
 * innocent of the blank-screen bug. It proved something else instead.
 *
 * ── WHY THIS IS SERIOUS ──────────────────────────────────────────────────
 * This is the screen a staff member reads before handing a bag to a
 * customer, inside a fifteen-minute window. A total off by 100x is not a
 * cosmetic slip: it is the number somebody reconciles a till against. And
 * `sendability-core` already refuses to push a menu whose prices look
 * implausible — the detail view had no equivalent check.
 *
 * ── WHY IT TAKES A LIST OF CANDIDATES ────────────────────────────────────
 * Leafly names the same quantity differently across cart-item shapes
 * (`discountedPriceCents` vs `priceCents`). Trying them in priority order
 * here keeps that decision in one tested place instead of at each call site.
 *
 * ── WHY IT DEMANDS AN INTEGER ────────────────────────────────────────────
 * The same reason `order-fetch-core`'s `intOrNull` does. A fractional value
 * in a field documented as minor units means the sender is not speaking the
 * protocol we think it is, and silently rounding it would convert a
 * detectable contract violation into a quiet money error. `null` renders as
 * an em dash, which a person investigates; a wrong number they do not.
 */
export function readMinorUnits(...candidates: unknown[]): number | null {
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)) {
      return value;
    }
  }
  return null;
}

/**
 * Sum Leafly's `taxes` array into a single minor-units figure.
 *
 * ── WHY A DEDICATED READER ───────────────────────────────────────────────
 * Because `Order.taxes` is NOT a number. The spec has it as
 * `$ref: Taxes`, which is an "array of TaxComponent ... broken out by tax
 * type", each carrying `amountCents`.
 *
 * The old code called `toMinorUnits(o.taxes)` on that array. `toMinorUnits`
 * accepts only numbers and strings, so an array fell through to `null` and
 * the tax line rendered as an em dash on every single order — measured.
 *
 * ── WHY A MISSING ARRAY IS NULL BUT AN EMPTY ONE IS ZERO ─────────────────
 * They are different facts. No `taxes` key means we were not told; an empty
 * array means Leafly told us there were none. The first must render "—" so
 * a person looks it up, the second may honestly render "$0.00".
 *
 * ── WHY ONE BAD COMPONENT POISONS THE SUM ────────────────────────────────
 * A partial tax total is worse than no tax total. If one component is
 * unreadable, the sum understates the tax, and understating tax on a
 * cannabis order is the direction that gets a shop in trouble. Returning
 * null makes the gap visible instead of plausible.
 */
export function readTaxesMinorUnits(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  let sum = 0;
  for (const component of value) {
    if (component === null || typeof component !== "object" || Array.isArray(component)) {
      return null;
    }
    const amount = readMinorUnits((component as Record<string, unknown>).amountCents);
    if (amount === null) return null;
    sum += amount;
  }
  return sum;
}

export function toMinorUnits(value: unknown): number | null {
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    text = String(value);
  } else if (typeof value === "string") {
    text = value.trim().replace(/[$,\s]/g, "");
    if (text === "") return null;
  } else {
    return null;
  }

  // Exponential notation is not money anyone typed; parse it numerically and
  // re-print so the digit surgery below always has a plain decimal to work on.
  if (/e/i.test(text)) {
    const n = Number(text);
    if (!Number.isFinite(n)) return null;
    text = n.toFixed(4);
  }

  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(text);
  if (m === null) return null;
  const [, sign, whole = "", frac = ""] = m;
  // "" and "." are matched by the pattern above but are not numbers.
  if (whole === "" && frac === "") return null;

  const cents = `${whole === "" ? "0" : whole}${frac.padEnd(2, "0").slice(0, 2)}`;
  let minor = Number(cents);
  if (!Number.isFinite(minor)) return null;

  // Half-up on the third decimal, applied to the DIGIT rather than to a
  // binary product, so 1.005 -> 101 exactly as a human would compute it.
  const third = frac.length > 2 ? Number(frac[2]) : 0;
  if (Number.isFinite(third) && third >= 5) minor += 1;

  return sign === "-" ? -minor : minor;
}

/**
 * Build the detail view model from a stored `leafly_orders.raw_order`.
 *
 * Total function: any input at all produces a valid object. That is not
 * defensive decoration — `raw_order` is `jsonb` written by a webhook handler
 * that is required to answer 200 even for a payload it does not recognise, so
 * an unreadable value there is an expected state, not an impossible one. The
 * detail view's job in that case is to show what it can and stay standing.
 */
export function readOrderDetail(raw: unknown): LeaflyOrderDetail {
  const empty: LeaflyOrderDetail = {
    leaflyOrderId: null,
    status: null,
    marketplace: null,
    fulfillmentMechanism: null,
    paymentPreference: null,
    customerName: null,
    dateOfBirth: null,
    phoneNumber: null,
    emailAddress: null,
    medicalStatus: null,
    medicalCardNumber: null,
    medicalCardState: null,
    medicalCardExpiration: null,
    lines: [],
    subtotalMinorUnits: null,
    taxesMinorUnits: null,
    totalMinorUnits: null,
    createdAt: null,
  };

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return empty;
  const o = raw as Record<string, unknown>;

  const first = str(o.firstName);
  const last = str(o.lastName);
  const customerName = first === null && last === null ? null : [first, last].filter(Boolean).join(" ");

  const rawLines = Array.isArray(o.cartItems) ? o.cartItems : [];
  const lines: DetailCartLine[] = [];
  for (const item of rawLines) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const li = item as Record<string, unknown>;
    // Leafly's cart item names the product across a couple of shapes
    // depending on catalog source, so the known keys are tried in order
    // rather than assuming one. An unnamed line still renders — with its
    // quantity and price — because a line the staff cannot see at all is
    // worse than one they must look up.
    const name =
      str(li.name) ??
      str(li.productName) ??
      str((li.variant as Record<string, unknown> | undefined)?.name) ??
      "Unnamed item";
    const qRaw = li.quantity;
    const quantity =
      typeof qRaw === "number" && Number.isFinite(qRaw) && qRaw > 0 ? Math.floor(qRaw) : 1;
    lines.push({
      name,
      quantity,
      // ── SLICE L-25 — READ THE FIELDS LEAFLY ACTUALLY SENDS ──────────────
      //
      // The previous key list — totalPrice / total / price — does not appear
      // anywhere in `CartItemOutgoing`. Measured against a spec-shaped cart
      // item, every line price came back null and every line rendered "—"
      // (scripts/recon/detail-money-probe.ts).
      //
      // The spec's actual whole-line fields, in the order that matters:
      //
      //   discountedPriceCents  "price of entire cart item (all quantity) in
      //                          minor units after discount application"
      //   priceCents            "original price of entire cart item (all
      //                          quantity) in minor units"
      //
      // `discountedPriceCents` comes FIRST because it is what the shopper
      // was actually charged. Showing the pre-discount figure to a staff
      // member reconciling a till would overstate every discounted line.
      //
      // `packagePrice` is the per-unit price, so it is multiplied by the
      // quantity to reach a line total. It is last because it is a fallback:
      // deriving a line total is strictly worse than being told one.
      //
      // ALREADY MINOR UNITS — note there is no `toMinorUnits` here. The
      // field names say `Cents` and the spec says "in minor units". Running
      // the dollars-to-cents converter over them multiplied every price by a
      // hundred.
      lineTotalMinorUnits: readMinorUnits(li.discountedPriceCents, li.priceCents) ??
        (readMinorUnits(li.packagePrice) === null
          ? null
          : (readMinorUnits(li.packagePrice) as number) * quantity),
    });
  }

  return {
    leaflyOrderId: str(o.id),
    status: str(o.status),
    marketplace: str(o.marketplace),
    fulfillmentMechanism: str(o.fulfillmentMechanism),
    paymentPreference: str(o.paymentPreference),
    customerName,
    dateOfBirth: str(o.dateOfBirth),
    phoneNumber: str(o.phoneNumber),
    emailAddress: str(o.emailAddress),
    medicalStatus: str(o.medicalStatus),
    medicalCardNumber: str(o.medicalCardNumber),
    medicalCardState: str(o.medicalCardState),
    medicalCardExpiration: str(o.medicalCardExpiration),
    lines,
    // ALREADY MINOR UNITS. There is deliberately no `toMinorUnits` on these
    // three lines, and that absence is the whole fix. See `readMinorUnits`
    // above for the spec quotes and the measured 100x defect; in short, the
    // spec says `subtotal` is "order total before taxes and fees in minor
    // units" and `total` is "order grand total in minor units", so a $48.03
    // order arrives as 4803 and multiplying it again rendered $4,803.00.
    //
    // `taxes` gets its own reader because it is not a number at all: the
    // spec has it as an array of TaxComponent "broken out by tax type", so
    // it must be summed over `amountCents` rather than parsed.
    subtotalMinorUnits: readMinorUnits(o.subtotal),
    taxesMinorUnits: readTaxesMinorUnits(o.taxes),
    totalMinorUnits: readMinorUnits(o.total),
    createdAt: str(o.createdAt),
  };
}

/* ------------------------------------------------------------------------- *
 * SLICE L-25 — TELLING "NEVER COLLECTED" FROM "EMPTY"
 * ------------------------------------------------------------------------- */

/**
 * Why a detail view has nothing to show.
 *
 * - `collected`     — we have the real Order payload. Render it.
 * - `never_fetched` — `raw_order` still holds Leafly's five-field submission
 *                     webhook. We never downloaded the order.
 * - `unreadable`    — there is a payload, but it is not a shape we recognise.
 */
export type DetailPayloadState = "collected" | "never_fetched" | "unreadable";

/**
 * Classify what is actually stored in `leafly_orders.raw_order`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS EXISTS TO NAME
 * ═══════════════════════════════════════════════════════════════════════════
 * The owner opened a Leafly order and found nothing at all:
 *
 *   > "when I open an order, everything is completely blank. There is no info
 *   >  at all. Is this why we can't acknowledge an order? Are we not getting
 *   >  the proper data from Leafly to acknowledge in the first place?"
 *
 * He diagnosed it correctly from the symptom alone.
 *
 * `raw_order` is written TWICE in an order's life:
 *
 *   1. `upsertLeaflyOrderFromWebhook()` stores the submission webhook, which
 *      per Leafly's own example is FIVE FIELDS — eventTime, eventType,
 *      orderId, orderIntegrationKey, acknowledgeBy. No cart. No customer. No
 *      totals.
 *   2. `collectLeaflyOrder()` performs the separate, authenticated
 *      `GET /{key}/orders/{id}` and OVERWRITES `raw_order` with the real
 *      Order — which is where cartItems, subtotal, total, firstName and
 *      lastName actually live.
 *
 * So a completely blank detail view is not a rendering bug. It is POSITIVE
 * EVIDENCE that step 2 never succeeded for that order.
 *
 * Measured rather than argued (`scripts/recon/blank-detail-probe.ts`): the
 * spec's own example webhook, run through the real production
 * `readOrderDetail`, yields 18 blank fields out of 18, while a real Order
 * payload through the same reader parses perfectly. The reader is fine; the
 * data was never there.
 *
 * ── WHY THIS IS A COMPLIANCE MATTER, NOT A COSMETIC ONE ──────────────────
 * Leafly's rule, verbatim: orders are acknowledged "as having been retrieved
 * **in whole** by your system". Acknowledging an order we never retrieved
 * asserts something untrue to a third party, permanently destroys our only
 * access to the customer's ID images, and leaves staff with no cart to build
 * the bag from.
 *
 * ── WHY THE WEBHOOK'S OWN KEYS ARE THE TEST ──────────────────────────────
 * The discriminator is `eventType` + `orderId` WITHOUT `id`. That combination
 * is unique to the webhook envelope: the real Order schema has `id`, and the
 * webhook has no `id` at all. Testing for "no cartItems" instead would be
 * wrong — a real order genuinely can have an empty cart, and reporting that
 * as "never collected" would send staff chasing a download that already
 * happened.
 */
export function classifyDetailPayload(raw: unknown): DetailPayloadState {
  if (raw === null || raw === undefined) return "never_fetched";
  if (typeof raw !== "object" || Array.isArray(raw)) return "unreadable";

  const o = raw as Record<string, unknown>;

  // The real Order carries `id`. The submission webhook never does.
  const hasOrderId = typeof o.id === "string" && o.id.trim() !== "";
  if (hasOrderId) return "collected";

  // The webhook envelope, identified by its own two markers.
  const hasEventType = typeof o.eventType === "string" && o.eventType.trim() !== "";
  const hasWebhookOrderId = typeof o.orderId === "string" && o.orderId.trim() !== "";
  if (hasEventType || hasWebhookOrderId) return "never_fetched";

  // An object with neither an `id` nor webhook markers. Could be `{}` from a
  // partial write. Reported as never_fetched rather than unreadable because
  // the ACTION is the same — collect it — and "unreadable" invites a bug
  // report where "press this button" would have fixed it.
  if (Object.keys(o).length === 0) return "never_fetched";

  return "unreadable";
}

/**
 * Minor units -> a string a person reads.
 *
 * Lives here rather than in the component so it is covered by the self-tests
 * below. There are half a dozen `formatCents` functions in this repository
 * already; none of them is imported because all of them take a NUMBER and
 * this view's whole point is that a missing amount is not zero.
 *
 * `null` becomes an em dash, never "$0.00". A staff member reading "$0.00"
 * on a total concludes the order is free and hands over the bag; reading "—"
 * they conclude the figure is missing and look it up. The two are opposite
 * actions, so they must not share a rendering.
 */
export function formatDetailMoney(minorUnits: number | null | undefined): string {
  if (typeof minorUnits !== "number" || !Number.isFinite(minorUnits)) return "—";
  const negative = minorUnits < 0;
  const abs = Math.abs(Math.trunc(minorUnits));
  const dollars = Math.floor(abs / 100);
  const cents = abs % 100;
  // Thousands separators: an order total is rarely four digits, but a monthly
  // figure rendered through the same helper would be unreadable without them.
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${grouped}.${String(cents).padStart(2, "0")}`;
}

/**
 * Mask a medical card number for display.
 *
 * ── WHY THIS IS MASKED WHEN THE REST OF THE ORDER IS NOT ───────────────────
 * The name, the cart and the phone number are all things the staff member is
 * about to see in person anyway — the customer is standing at the counter.
 * A medical card number is different: it is a state-issued identifier that is
 * useful to somebody who steals it and useless to the person checking an
 * order. Showing the last four is enough to CONFIRM a card the customer is
 * holding, which is the only job this field has on this screen.
 *
 * Short values are masked entirely rather than partially. Revealing the last
 * four of a five-character value reveals almost all of it.
 */
export function maskMedicalCardNumber(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t === "") return null;
  if (t.length <= 4) return "•".repeat(t.length);
  return `${"•".repeat(Math.min(t.length - 4, 8))}${t.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// 4. SELF-TESTS (house rule 5)
// ---------------------------------------------------------------------------

export function __runLeaflyOrderDetailTests(): { passed: number; failed: number; messages: string[] } {
  let passed = 0;
  let failed = 0;
  const messages: string[] = [];
  const ok = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      messages.push(`FAIL: ${label}`);
    }
  };
  const eq = (label: string, actual: unknown, expected: unknown) =>
    ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`, actual === expected);

  // ---- the media kinds -----------------------------------------------------
  eq("exactly two media kinds", LEAFLY_MEDIA_KINDS.length, 2);
  ok("government id is a kind", isLeaflyMediaKind("government_id"));
  ok("medical id is a kind", isLeaflyMediaKind("medical_id"));
  ok("an arbitrary string is not a kind", !isLeaflyMediaKind("passport"));
  ok("a path traversal is not a kind", !isLeaflyMediaKind("../../secrets"));
  ok("undefined is not a kind", !isLeaflyMediaKind(undefined));
  ok("null is not a kind", !isLeaflyMediaKind(null));
  ok("a number is not a kind", !isLeaflyMediaKind(1));
  ok("an object is not a kind", !isLeaflyMediaKind({ kind: "government_id" }));
  for (const k of LEAFLY_MEDIA_KINDS) {
    ok(`${k} has a label`, MEDIA_KIND_LABEL[k].length > 0);
    ok(`${k} round-trips the guard`, isLeaflyMediaKind(k));
  }
  // The spec calls these "government id" and "medical id"; the labels must be
  // recognisable to a person, not a copy of the wire key.
  ok("the government label is human", /government/i.test(MEDIA_KIND_LABEL.government_id));
  ok("the medical label is human", /medical/i.test(MEDIA_KIND_LABEL.medical_id));
  ok("the labels differ", MEDIA_KIND_LABEL.government_id !== MEDIA_KIND_LABEL.medical_id);

  // ---- the access rule -----------------------------------------------------
  const ready = decideMediaAccess({
    leaflyOrderId: "ord-1",
    acknowledgedAt: null,
    leaflyStatus: "pending",
  });
  ok("pending + unacknowledged is allowed", ready.allowed);
  eq("…with code ready", ready.code, "ready");
  ok("…and is not permanently closed", !ready.permanentlyClosed);
  ok("…and warns that acknowledging ends access", /permanently/i.test(ready.message));

  const acked = decideMediaAccess({
    leaflyOrderId: "ord-1",
    acknowledgedAt: "2026-01-01T00:00:00Z",
    leaflyStatus: "pending",
  });
  ok("acknowledged is refused", !acked.allowed);
  eq("…with the acknowledged code", acked.code, "already_acknowledged");
  ok("…and is permanent", acked.permanentlyClosed);
  ok("…and says so in words", /permanently/i.test(acked.message));
  // The operator still has a job to do; the sentence must not dead-end.
  ok("…and tells them what to do instead", /physical ID/i.test(acked.message));

  const notPending = decideMediaAccess({
    leaflyOrderId: "ord-1",
    acknowledgedAt: null,
    leaflyStatus: "canceled",
  });
  ok("a non-pending order is refused", !notPending.allowed);
  eq("…with the not-pending code", notPending.code, "not_pending");
  ok("…is permanent", notPending.permanentlyClosed);
  ok("…names the status", notPending.message.includes("canceled"));
  // This is the case that must NOT read like an accusation: nobody here did
  // anything wrong when Leafly auto-cancels.
  ok("…does not blame the operator", /nothing was done wrong/i.test(notPending.message));

  // THE AND-NOT-OR CASE. Acknowledged *and* no longer pending. Reporting the
  // acknowledgement is the useful answer; reporting "not pending" would be
  // true and would hide the cause.
  const both = decideMediaAccess({
    leaflyOrderId: "ord-1",
    acknowledgedAt: "2026-01-01T00:00:00Z",
    leaflyStatus: "canceled",
  });
  eq("acknowledged beats not-pending in the message", both.code, "already_acknowledged");
  ok("…and is still refused", !both.allowed);

  const noId = decideMediaAccess({ leaflyOrderId: "", acknowledgedAt: null, leaflyStatus: "pending" });
  ok("a blank order id is refused", !noId.allowed);
  eq("…with the no-id code", noId.code, "no_order_id");
  // Recoverable, so it must NOT tell the operator the door is shut forever.
  ok("…and is not reported as permanent", !noId.permanentlyClosed);
  eq(
    "whitespace-only id is the same as blank",
    decideMediaAccess({ leaflyOrderId: "   ", leaflyStatus: "pending" }).code,
    "no_order_id",
  );
  eq(
    "a null id is the same as blank",
    decideMediaAccess({ leaflyOrderId: null, leaflyStatus: "pending" }).code,
    "no_order_id",
  );
  eq(
    "an undefined id is the same as blank",
    decideMediaAccess({ leaflyStatus: "pending" }).code,
    "no_order_id",
  );

  // The id check must come FIRST: with no id there is nothing to ask about,
  // so reporting the status would be answering a question we cannot even pose.
  eq(
    "no id beats not-pending",
    decideMediaAccess({ leaflyOrderId: "", leaflyStatus: "canceled" }).code,
    "no_order_id",
  );
  eq(
    "no id beats acknowledged",
    decideMediaAccess({ leaflyOrderId: "", acknowledgedAt: "2026-01-01T00:00:00Z" }).code,
    "no_order_id",
  );

  // Status matching is case- and whitespace-insensitive, because the value is
  // stored verbatim from a webhook payload and casing is not ours to control.
  ok(
    "PENDING in caps still opens the window",
    decideMediaAccess({ leaflyOrderId: "o", leaflyStatus: "PENDING" }).allowed,
  );
  ok(
    "padded pending still opens the window",
    decideMediaAccess({ leaflyOrderId: "o", leaflyStatus: "  pending  " }).allowed,
  );
  ok(
    "a blank acknowledgedAt counts as unacknowledged",
    decideMediaAccess({ leaflyOrderId: "o", acknowledgedAt: "   ", leaflyStatus: "pending" }).allowed,
  );
  ok(
    "a missing status is refused, not defaulted to pending",
    !decideMediaAccess({ leaflyOrderId: "o" }).allowed,
  );
  ok(
    "an unknown future status is refused rather than allowed",
    !decideMediaAccess({ leaflyOrderId: "o", leaflyStatus: "some_new_leafly_status" }).allowed,
  );
  // Every status Leafly documents, other than pending, must be refused. This
  // is the denylist-vs-allowlist guard: the rule is stated positively, so a
  // new status is refused by construction.
  for (const s of [
    "confirmed",
    "ready",
    "out_for_delivery",
    "arrived_at_customer",
    "picked_up",
    "canceled",
    "expired",
  ]) {
    ok(`status ${s} is refused`, !decideMediaAccess({ leaflyOrderId: "o", leaflyStatus: s }).allowed);
  }
  eq("the required status is pending", LEAFLY_MEDIA_REQUIRED_STATUS, "pending");

  // Every verdict must carry a non-empty sentence. A silent refusal is the
  // failure this module exists to prevent.
  for (const v of [ready, acked, notPending, both, noId]) {
    ok(`verdict ${v.code} has a message`, v.message.trim().length > 20);
    ok(`verdict ${v.code} allowed matches code`, v.allowed === (v.code === "ready"));
  }

  // ---- the URL -------------------------------------------------------------
  const base = "https://reservations-api-sandbox.leafly.io/v1/order_integration";
  const gov = leaflyMediaUrl(base, "key-1", "ord-9", "government_id");
  eq("the government url is exact", gov, `${base}/key-1/government_id/ord-9`);
  const med = leaflyMediaUrl(base, "key-1", "ord-9", "medical_id");
  eq("the medical url is exact", med, `${base}/key-1/medical_id/ord-9`);
  // THE SHAPE TRAP: media lives at the root of the namespace, NOT under
  // /orders/{id}/. A wrong path here 404s and reads as "no such order".
  ok("the media url does NOT go under /orders/", !gov.includes("/orders/"));
  ok("…for the medical one either", !med.includes("/orders/"));
  ok("the two kinds produce different urls", gov !== med);
  ok(
    "a slash in the key is encoded",
    leaflyMediaUrl(base, "a/b", "ord", "government_id").includes("a%2Fb"),
  );
  ok(
    "a traversal in the order id is encoded",
    leaflyMediaUrl(base, "k", "../../escape", "government_id").includes("..%2F..%2Fescape"),
  );
  ok(
    "a space in the order id is encoded",
    leaflyMediaUrl(base, "k", "a b", "medical_id").includes("a%20b"),
  );
  ok(
    "a query char in the order id cannot start a query string",
    !leaflyMediaUrl(base, "k", "a?b=1", "medical_id").includes("?b=1"),
  );

  // ---- money, already in minor units (L-25) --------------------------------
  // These guard the 100x defect. `readMinorUnits` must NEVER scale, because
  // every money field on a Leafly Order is documented as minor units already.
  eq("an integer is taken as given, never scaled", readMinorUnits(4803), 4803);
  eq("zero is zero, not null", readMinorUnits(0), 0);
  eq("a negative reads (refunds exist)", readMinorUnits(-500), -500);
  eq("a fraction is refused, not rounded", readMinorUnits(19.99), null);
  eq("a numeric string is refused", readMinorUnits("4803"), null);
  eq("null is null", readMinorUnits(null), null);
  eq("undefined is null", readMinorUnits(undefined), null);
  eq("NaN is null", readMinorUnits(NaN), null);
  eq("Infinity is null", readMinorUnits(Infinity), null);
  eq("an object is null", readMinorUnits({}), null);
  eq("a boolean is null", readMinorUnits(true), null);
  eq("no candidates at all is null", readMinorUnits(), null);
  // Candidate priority: the discounted price wins, because that is what the
  // customer is actually charged.
  eq("the first readable candidate wins", readMinorUnits(6710, 9999), 6710);
  eq("an unreadable first candidate falls through", readMinorUnits(undefined, 6710), 6710);
  eq("a fractional first candidate falls through", readMinorUnits(1.5, 6710), 6710);
  eq("zero still wins over a later candidate", readMinorUnits(0, 6710), 0);
  eq("all candidates unreadable is null", readMinorUnits(undefined, null, "x"), null);

  // ---- money, the taxes ARRAY (L-25) --------------------------------------
  // `Order.taxes` is an array of TaxComponent, not a number. Reading it with
  // a scalar parser returned null on every order ever displayed.
  eq(
    "components are summed over amountCents",
    readTaxesMinorUnits([{ label: "excise", amountCents: 500 }, { label: "state", amountCents: 303 }]),
    803,
  );
  eq("a single component reads", readTaxesMinorUnits([{ label: "x", amountCents: 8582 }]), 8582);
  // Two different facts, two different answers.
  eq("an EMPTY array is a truthful zero", readTaxesMinorUnits([]), 0);
  eq("a MISSING array is null, not zero", readTaxesMinorUnits(undefined), null);
  eq("null is null", readTaxesMinorUnits(null), null);
  eq("a bare number is null (it is not an array)", readTaxesMinorUnits(803), null);
  eq("a numeric string is null", readTaxesMinorUnits("803"), null);
  eq("an object is null", readTaxesMinorUnits({ amountCents: 803 }), null);
  // One bad component poisons the sum: understating cannabis tax is the
  // direction that gets a shop in trouble, so the gap must stay visible.
  eq(
    "one unreadable component poisons the whole sum",
    readTaxesMinorUnits([{ amountCents: 500 }, { amountCents: "303" }]),
    null,
  );
  eq(
    "a component missing amountCents poisons the sum",
    readTaxesMinorUnits([{ amountCents: 500 }, { label: "state" }]),
    null,
  );
  eq("a null component poisons the sum", readTaxesMinorUnits([{ amountCents: 500 }, null]), null);
  eq("a nested array component poisons the sum", readTaxesMinorUnits([[500]]), null);
  eq(
    "a fractional component poisons the sum",
    readTaxesMinorUnits([{ amountCents: 50.5 }]),
    null,
  );
  // Proof the sum is not silently scaled anywhere.
  ok(
    "the summed taxes are never multiplied by a hundred",
    readTaxesMinorUnits([{ amountCents: 803 }]) === 803,
  );

  // ---- money, decimal currency strings ------------------------------------
  // `toMinorUnits` stays: it is the correct reader for DECIMAL amounts, which
  // is a different problem from an Order payload. Cross-checked against
  // `reportMoneyToMinor` in the online-orders-report suite.
  eq("a plain number converts", toMinorUnits(12), 1200);
  eq("a decimal converts", toMinorUnits(19.99), 1999);
  // The float trap: 19.99 * 100 is 1998.9999999999998 in IEEE 754. Truncation
  // would lose a cent on an extremely ordinary price.
  eq("the float rounding trap is handled", toMinorUnits(19.99), 1999);
  eq("another float trap", toMinorUnits(1.005), 101);
  eq("a string converts", toMinorUnits("19.99"), 1999);
  eq("a dollar sign is stripped", toMinorUnits("$19.99"), 1999);
  eq("a thousands comma is stripped", toMinorUnits("1,234.56"), 123456);
  eq("zero is zero, not null", toMinorUnits(0), 0);
  eq("a negative converts (refunds exist)", toMinorUnits(-5), -500);
  eq("null is null", toMinorUnits(null), null);
  eq("undefined is null", toMinorUnits(undefined), null);
  eq("a blank string is null", toMinorUnits("   "), null);
  eq("gibberish is null", toMinorUnits("abc"), null);
  eq("NaN is null", toMinorUnits(NaN), null);
  eq("Infinity is null", toMinorUnits(Infinity), null);
  eq("an object is null", toMinorUnits({}), null);
  eq("an array is null", toMinorUnits([]), null);
  eq("a boolean is null", toMinorUnits(true), null);
  // MUTANT 9 of the L-24 probe survived because NOTHING above reaches the
  // `whole === "" && frac === ""` branch: "" and "   " exit at the
  // empty-string guard, "abc" fails the regex, and the non-strings return
  // before it. These four inputs are the entire reachable set for that line,
  // established by measurement. `$0.00` instead of "unreadable" is how a bag
  // leaves the counter without payment.
  eq("a lone decimal point is null, not zero", toMinorUnits("."), null);
  eq("a lone minus sign is null, not zero", toMinorUnits("-"), null);
  eq("a minus and a point is null, not zero", toMinorUnits("-."), null);
  eq("a stripped currency symbol and a point is null", toMinorUnits("$."), null);
  // Controls: the guard must reject SEPARATORS, not decimal points generally.
  eq("a leading decimal point still reads", toMinorUnits(".5"), 50);
  eq("a trailing decimal point still reads", toMinorUnits("5."), 500);
  eq("a negative leading point still reads", toMinorUnits("-.5"), -50);

  // ---- reading the payload -------------------------------------------------
  const detail = readOrderDetail({
    id: "ord-77",
    status: "pending",
    marketplace: "leafly",
    fulfillmentMechanism: "pickup",
    paymentPreference: "cash",
    firstName: "Dana",
    lastName: "Reeves",
    dateOfBirth: "1990-04-02",
    phoneNumber: "+12065550100",
    emailAddress: "dana@example.com",
    medicalStatus: "none",
    // ── SLICE L-25 — THIS FIXTURE NOW MATCHES THE SPEC ──────────────────────
    //
    // It used to read `subtotal: 40, taxes: 14.8, total: 54.8` with cart keys
    // `totalPrice` / `total`. Not one of those was a real Leafly shape:
    //
    //   * `Order.subtotal` and `Order.total` are documented "in minor units",
    //     so a $40 subtotal arrives as 4000, never as 40.
    //   * `Order.taxes` is `$ref: Taxes` — an ARRAY of TaxComponent "broken
    //     out by tax type", each with `amountCents`. Never a decimal.
    //   * `CartItemOutgoing` has no `totalPrice`, no `total` and no `price`.
    //     Its required money keys are `packagePrice`, `discountedPackagePrice`,
    //     `discountedPriceCents`, `priceCents`, `savingsCents`.
    //
    // Because the fixture invented dollars, the assertions below demanded a
    // x100 conversion, and the reader was written to satisfy them. The suite
    // was green and the screen was wrong by a factor of a hundred. That is
    // the real lesson of this defect: a fixture is an authority claim, and
    // this one was never checked against the spec it claimed to model.
    //
    // Values below are the spec's OWN example arithmetic, verified:
    //   packagePrice 3355 x quantity 2 === priceCents 6710
    //   (docs/leafly-specs/order-api-v1.openapi.json, components.examples.Order)
    subtotal: 4000,
    taxes: [
      { label: "excise tax", amountCents: 1000 },
      { label: "state sales tax", amountCents: 480 },
    ],
    total: 5480,
    createdAt: "2026-01-02T03:04:05Z",
    cartItems: [
      // Whole-line price given outright, discounted equal to original.
      {
        name: "Blue Dream 3.5g",
        quantity: 2,
        packagePrice: 1500,
        priceCents: 3000,
        discountedPriceCents: 3000,
      },
      // Fallback path: no whole-line field, so packagePrice x quantity.
      { productName: "Gummies", quantity: 1, packagePrice: 1000 },
    ],
  });
  eq("the order id is read", detail.leaflyOrderId, "ord-77");
  eq("the status is read", detail.status, "pending");
  eq("the name is joined", detail.customerName, "Dana Reeves");
  eq("the dob is read", detail.dateOfBirth, "1990-04-02");
  eq("the phone is read", detail.phoneNumber, "+12065550100");
  eq("the email is read", detail.emailAddress, "dana@example.com");
  eq("two lines are read", detail.lines.length, 2);
  eq("the first line name", detail.lines[0]?.name, "Blue Dream 3.5g");
  eq("the first line quantity", detail.lines[0]?.quantity, 2);
  // The expected figures are unchanged from before the fix; what changed is
  // that they are now reached from a spec-shaped payload instead of an
  // invented one. $30.00 is 3000 minor units on the wire and 3000 on screen.
  eq("the first line total is taken as given", detail.lines[0]?.lineTotalMinorUnits, 3000);
  eq("the fallback product name key works", detail.lines[1]?.name, "Gummies");
  eq("a per-unit price is multiplied by quantity", detail.lines[1]?.lineTotalMinorUnits, 1000);
  eq("the subtotal is not rescaled", detail.subtotalMinorUnits, 4000);
  eq("the taxes array is summed", detail.taxesMinorUnits, 1480);
  eq("the total is not rescaled", detail.totalMinorUnits, 5480);

  // ── THE 100x REGRESSION, PINNED ───────────────────────────────────────────
  // The exact defect the operator would have seen: a $54.80 order displayed
  // as $5,480.00. If anyone reintroduces a dollars-to-cents conversion on
  // this path, these three fail immediately and by name.
  ok("the total is NOT a hundred times the wire value", detail.totalMinorUnits !== 548_000);
  ok("the subtotal is NOT a hundred times the wire value", detail.subtotalMinorUnits !== 400_000);
  ok("the line total is NOT a hundred times the wire value", detail.lines[0]?.lineTotalMinorUnits !== 300_000);
  // And the taxes array must not silently read as "unknown" any more.
  ok("the taxes are no longer null on every order", detail.taxesMinorUnits !== null);
  // Internal consistency: subtotal + taxes === total, which is the check a
  // person does by eye and the one that catches a unit mismatch fastest.
  eq(
    "subtotal plus taxes equals the total",
    (detail.subtotalMinorUnits ?? 0) + (detail.taxesMinorUnits ?? 0),
    detail.totalMinorUnits,
  );
  // And the lines must add up to the subtotal.
  eq(
    "the line totals add up to the subtotal",
    detail.lines.reduce((sum, l) => sum + (l.lineTotalMinorUnits ?? 0), 0),
    detail.subtotalMinorUnits,
  );

  // ── NEGATIVE CONTROL: THE KEYS THAT NEVER EXISTED ─────────────────────────
  // `totalPrice` / `total` / `price` are the keys the old reader looked for.
  // They appear nowhere in `CartItemOutgoing`, so a cart item carrying only
  // those must read as UNKNOWN rather than inventing a figure. This control
  // is what proves the fixture rewrite above was a real fix and not a
  // repainted expectation: if the old keys still worked, nothing changed.
  {
    const ghost = readOrderDetail({
      id: "ord-ghost",
      cartItems: [{ name: "Phantom", quantity: 2, totalPrice: 30, total: "10.00", price: 15 }],
    });
    eq("a ghost-key cart item still yields a line", ghost.lines.length, 1);
    eq("...with the name intact", ghost.lines[0]?.name, "Phantom");
    eq("...but no price, because Leafly never sends those keys", ghost.lines[0]?.lineTotalMinorUnits, null);
    // An order with no money fields at all must report unknown, not zero.
    eq("a payload with no subtotal reports unknown", ghost.subtotalMinorUnits, null);
    eq("a payload with no taxes reports unknown", ghost.taxesMinorUnits, null);
    eq("a payload with no total reports unknown", ghost.totalMinorUnits, null);
  }

  // Total-function guarantees. `raw_order` is jsonb written by a handler that
  // must answer 200 even for payloads it does not recognise, so every one of
  // these is a REAL possible stored value, not a hypothetical.
  for (const bad of [null, undefined, 1, "a string", [], true, NaN]) {
    const d = readOrderDetail(bad);
    ok(`readOrderDetail survives ${JSON.stringify(bad) ?? "undefined"}`, Array.isArray(d.lines));
    eq(`…with no lines for ${JSON.stringify(bad) ?? "undefined"}`, d.lines.length, 0);
    eq(`…and a null id for ${JSON.stringify(bad) ?? "undefined"}`, d.leaflyOrderId, null);
  }

  // The UberEats shape the spec explicitly warns about: first name and last
  // initial only, NO email, and a null phone number.
  const uber = readOrderDetail({
    id: "ord-ue",
    marketplace: "uberEats",
    firstName: "Sam",
    lastName: "T",
    emailAddress: null,
    phoneNumber: null,
    cartItems: [],
  });
  eq("an uberEats order still reads", uber.leaflyOrderId, "ord-ue");
  eq("…names it as uberEats", uber.marketplace, "uberEats");
  eq("…joins the partial name", uber.customerName, "Sam T");
  eq("…tolerates a null email", uber.emailAddress, null);
  eq("…tolerates a null phone", uber.phoneNumber, null);

  // Partial names must not produce stray whitespace.
  eq("first name only", readOrderDetail({ firstName: "Dana" }).customerName, "Dana");
  eq("last name only", readOrderDetail({ lastName: "Reeves" }).customerName, "Reeves");
  eq("no name at all is null, not empty", readOrderDetail({}).customerName, null);
  eq("blank names are null", readOrderDetail({ firstName: "  ", lastName: "  " }).customerName, null);

  // Malformed cart entries are skipped, not crashed on, and must not become
  // phantom lines.
  const messy = readOrderDetail({
    cartItems: [null, 5, "x", [], { quantity: 3 }, { name: "Real", quantity: 1, totalPrice: 5 }],
  });
  eq("only the object lines survive", messy.lines.length, 2);
  eq("an unnamed line is labelled, not dropped", messy.lines[0]?.name, "Unnamed item");
  eq("…and keeps its quantity", messy.lines[0]?.quantity, 3);
  eq("…and reports an unknown price as null", messy.lines[0]?.lineTotalMinorUnits, null);
  eq("the good line is intact", messy.lines[1]?.name, "Real");

  // Quantity must never be zero or negative on a picking list: a line with
  // quantity 0 would be built as nothing and silently shorted.
  eq("a zero quantity floors to 1", readOrderDetail({ cartItems: [{ quantity: 0 }] }).lines[0]?.quantity, 1);
  eq("a negative quantity floors to 1", readOrderDetail({ cartItems: [{ quantity: -4 }] }).lines[0]?.quantity, 1);
  eq(
    "a fractional quantity floors to a whole number",
    readOrderDetail({ cartItems: [{ quantity: 2.7 }] }).lines[0]?.quantity,
    2,
  );
  eq(
    "a non-numeric quantity becomes 1",
    readOrderDetail({ cartItems: [{ quantity: "two" }] }).lines[0]?.quantity,
    1,
  );
  eq(
    "a missing price is null rather than zero",
    readOrderDetail({ cartItems: [{ name: "x", quantity: 1 }] }).lines[0]?.lineTotalMinorUnits,
    null,
  );

  // A missing total must be null, never 0 — "$0.00" is how a bag leaves
  // without payment.
  eq("a missing total is null not zero", readOrderDetail({}).totalMinorUnits, null);
  eq("a missing subtotal is null not zero", readOrderDetail({}).subtotalMinorUnits, null);
  eq("a missing taxes is null not zero", readOrderDetail({}).taxesMinorUnits, null);
  // But a genuine zero must survive as zero.
  eq("a genuine zero total survives", readOrderDetail({ total: 0 }).totalMinorUnits, 0);

  // Medical fields, which are the whole reason the medical_id endpoint exists.
  const medical = readOrderDetail({
    medicalStatus: "medical",
    medicalCardNumber: "WA-12345",
    medicalCardState: "WA",
    medicalCardExpiration: "2027-01-01",
  });
  eq("the medical status is read", medical.medicalStatus, "medical");
  eq("the card number is read", medical.medicalCardNumber, "WA-12345");
  eq("the card state is read", medical.medicalCardState, "WA");
  eq("the card expiry is read", medical.medicalCardExpiration, "2027-01-01");

  // ---- 5. formatDetailMoney ----------------------------------------------
  // THE assertion of this group. A missing amount and a free item must not
  // render the same way, because the staff response to each is opposite.
  eq("null money is an em dash, never $0.00", formatDetailMoney(null), "—");
  eq("undefined money is an em dash", formatDetailMoney(undefined), "—");
  eq("NaN money is an em dash", formatDetailMoney(Number.NaN), "—");
  eq("Infinity money is an em dash", formatDetailMoney(Number.POSITIVE_INFINITY), "—");
  // A genuine zero IS rendered as zero. It is a fact, not a gap.
  eq("a genuine zero renders as $0.00", formatDetailMoney(0), "$0.00");
  eq("one cent", formatDetailMoney(1), "$0.01");
  eq("ten cents pads correctly", formatDetailMoney(10), "$0.10");
  eq("ninety-nine cents", formatDetailMoney(99), "$0.99");
  eq("a dollar", formatDetailMoney(100), "$1.00");
  eq("a typical price", formatDetailMoney(1999), "$19.99");
  eq("a round hundred", formatDetailMoney(10_000), "$100.00");
  // Grouping only kicks in at four digits of dollars.
  eq("no separator below a thousand", formatDetailMoney(99_999), "$999.99");
  eq("a thousand gets a separator", formatDetailMoney(100_000), "$1,000.00");
  eq("a million groups twice", formatDetailMoney(100_000_000), "$1,000,000.00");
  // Negatives: a refund line. The sign goes BEFORE the dollar sign, which is
  // the convention every other money surface in this repo uses.
  eq("a negative keeps the sign outside", formatDetailMoney(-1999), "-$19.99");
  eq("a negative cent", formatDetailMoney(-1), "-$0.01");
  eq("negative zero is not signed", formatDetailMoney(-0), "$0.00");
  // A non-integer minor unit is a programming error upstream; truncate
  // rather than throw, because a detail view must stay standing.
  eq("a fractional minor unit truncates", formatDetailMoney(1999.7), "$19.99");
  ok("money output always starts with $ or -", /^-?\$/.test(formatDetailMoney(1234)));
  ok("money output always has exactly two decimals", /\.\d{2}$/.test(formatDetailMoney(5)));

  // ---- 6. maskMedicalCardNumber ------------------------------------------
  eq("null card masks to null", maskMedicalCardNumber(null), null);
  eq("undefined card masks to null", maskMedicalCardNumber(undefined), null);
  eq("empty card masks to null", maskMedicalCardNumber(""), null);
  eq("whitespace card masks to null", maskMedicalCardNumber("   "), null);
  // Short values are masked ENTIRELY. Showing the last four of a five
  // character value would reveal four fifths of it.
  eq("a 4-char card is fully masked", maskMedicalCardNumber("1234"), "••••");
  eq("a 1-char card is fully masked", maskMedicalCardNumber("7"), "•");
  eq("a 5-char card shows only the last four", maskMedicalCardNumber("12345"), "•2345");
  eq("a typical card shows the last four", maskMedicalCardNumber("WA-123456789"), "••••••••6789");
  // The mask is capped so a long identifier does not render as a wall of dots
  // that pushes the useful digits off a narrow tablet screen.
  eq(
    "the dot run is capped at eight",
    maskMedicalCardNumber("A".repeat(40) + "6789"),
    "••••••••6789",
  );
  const masked = maskMedicalCardNumber("WA-987654321");
  ok("a masked card never contains the leading characters", masked !== null && !masked.includes("WA-"));
  ok("a masked card does keep the last four", masked !== null && masked.endsWith("4321"));
  ok("a masked card is never the original", maskMedicalCardNumber("WA-987654321") !== "WA-987654321");
  eq("the card is trimmed before masking", maskMedicalCardNumber("  12345  "), "•2345");

  // ---- SLICE L-25: classifyDetailPayload -----------------------------------
  //
  // The owner reported opening an order and seeing "everything is completely
  // blank. There is no info at all." These assertions pin the distinction
  // that explains it: a five-field submission webhook is NOT an order.

  // The exact payload Leafly's own spec gives as the `order_submit` example.
  // This is the shape that was sitting in `raw_order` when the detail view
  // rendered 18 blank fields out of 18.
  const submissionWebhook = {
    eventTime: "2024-01-01T00:00:00Z",
    eventType: "order_submit",
    orderId: "abc-123",
    orderIntegrationKey: "key-1",
    acknowledgeBy: "2024-01-01T00:15:00Z",
  };
  eq(
    "the submission webhook is recognised as never collected",
    classifyDetailPayload(submissionWebhook),
    "never_fetched",
  );

  // A real Order. The discriminator is `id`, which the webhook never carries.
  eq(
    "a real order payload is collected",
    classifyDetailPayload({ id: "abc-123", cartItems: [] }),
    "collected",
  );

  // THE ASSERTION THAT PROTECTS A REAL ORDER FROM A FALSE ALARM.
  // It is tempting to classify by "has no cartItems", and that is wrong: an
  // order can legitimately have an empty cart, and calling it "never
  // collected" would send staff chasing a download that already happened.
  eq(
    "a collected order with an empty cart is still collected",
    classifyDetailPayload({ id: "abc-123", cartItems: [], total: 0 }),
    "collected",
  );
  eq(
    "an order with an id but nothing else is still collected",
    classifyDetailPayload({ id: "abc-123" }),
    "collected",
  );

  // An id that is present but blank is not an id.
  eq("a blank id is not a collected order", classifyDetailPayload({ id: "   " }), "unreadable");
  eq(
    "a blank id with webhook markers is never_fetched",
    classifyDetailPayload({ id: "", eventType: "order_submit" }),
    "never_fetched",
  );

  // Either webhook marker alone is enough; Leafly could add or drop fields.
  eq(
    "eventType alone marks the envelope",
    classifyDetailPayload({ eventType: "order_submit" }),
    "never_fetched",
  );
  eq(
    "orderId alone marks the envelope",
    classifyDetailPayload({ orderId: "abc-123" }),
    "never_fetched",
  );

  // Nothing stored at all. Same action as never_fetched: go and collect it.
  eq("null is never collected", classifyDetailPayload(null), "never_fetched");
  eq("undefined is never collected", classifyDetailPayload(undefined), "never_fetched");
  eq("an empty object is never collected", classifyDetailPayload({}), "never_fetched");

  // Shapes that are not an order payload at all.
  eq("a string is unreadable", classifyDetailPayload("abc-123"), "unreadable");
  eq("a number is unreadable", classifyDetailPayload(42), "unreadable");
  eq("an array is unreadable", classifyDetailPayload([{ id: "abc" }]), "unreadable");
  eq(
    "an unrecognised object is unreadable",
    classifyDetailPayload({ something: "else" }),
    "unreadable",
  );

  // THE END-TO-END TIE-BACK. The classifier's verdict must agree with what
  // the reader actually produces, or the panel would explain one thing and
  // render another.
  const webhookDetail = readOrderDetail(submissionWebhook);
  ok(
    "the reader finds no customer in a submission webhook",
    webhookDetail.customerName === null,
  );
  ok("the reader finds no cart in a submission webhook", webhookDetail.lines.length === 0);
  ok(
    "the reader finds no total in a submission webhook",
    webhookDetail.totalMinorUnits === null,
  );

  return { passed, failed, messages };
}

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
      lineTotalMinorUnits: toMinorUnits(li.totalPrice ?? li.total ?? li.price),
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
    subtotalMinorUnits: toMinorUnits(o.subtotal),
    taxesMinorUnits: toMinorUnits(o.taxes),
    totalMinorUnits: toMinorUnits(o.total),
    createdAt: str(o.createdAt),
  };
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

  // ---- money ---------------------------------------------------------------
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
    subtotal: 40,
    taxes: 14.8,
    total: 54.8,
    createdAt: "2026-01-02T03:04:05Z",
    cartItems: [
      { name: "Blue Dream 3.5g", quantity: 2, totalPrice: 30 },
      { productName: "Gummies", quantity: 1, total: "10.00" },
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
  eq("the first line total", detail.lines[0]?.lineTotalMinorUnits, 3000);
  eq("the fallback product name key works", detail.lines[1]?.name, "Gummies");
  eq("a string line total converts", detail.lines[1]?.lineTotalMinorUnits, 1000);
  eq("the subtotal converts", detail.subtotalMinorUnits, 4000);
  eq("the taxes convert", detail.taxesMinorUnits, 1480);
  eq("the total converts", detail.totalMinorUnits, 5480);

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

  return { passed, failed, messages };
}

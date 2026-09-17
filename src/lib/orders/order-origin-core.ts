/**
 * src/lib/orders/order-origin-core.ts
 *
 * SLICE L-2 — WHERE AN ORDER CAME FROM.
 *
 * PURE. No I/O, no database, no network, no clock. Every function takes what it
 * needs and returns a value, so the shop's rules about origin can be proven in
 * CI without a Raspberry Pi, a register, or a Leafly account.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The owner asked for four things in one breath: put Leafly orders on the
 * register, announce them on the PA with a different chime, print them on the
 * shop's own receipt printer, and give staff a way to tell the two kinds of
 * order apart. Those read like four features. They are not. They are four
 * consumers of ONE fact that does not currently exist anywhere in this codebase:
 *
 *     public.orders has no source / origin / channel column.
 *     (verified against supabase/migrations/0007_slice7_orders.sql — the only
 *      `origin` column in the repo belongs to purchase_orders and is unrelated.)
 *
 * Every order in that table is implicitly a Greenway website order, because
 * until now that was the only kind there was.
 *
 * So if each of the three subsystems answers "where did this come from?" on its
 * own, we get three different answers that drift apart. We have measured what
 * that costs before. Standing rule 11 exists because five brand matchers were
 * unified across the menu half while the receiving door kept its own copy, and
 * that one straggler silently dropped 453 of 771 manifest spellings. Slice L-1
 * found the same shape again: ONE false sentence in a document produced EIGHT
 * field defects. A fact with several homes becomes several facts.
 *
 * This module is therefore the single home. It is deliberately boring: a list of
 * the origins that exist, and pure functions mapping an origin to the decisions
 * that depend on it. No I/O means nothing here can be "temporarily" bypassed.
 *
 * WHAT THIS MODULE DOES NOT DO
 * ----------------------------
 * It does not write a column, receive a webhook, queue a chime or print a
 * receipt. Those are slices L-5 and L-6. Leafly cannot send us an order at all
 * until `availableForPickup` is sent (finding L-09, slice L-3), so building the
 * plumbing first would produce features with nothing to carry. What lands now is
 * the vocabulary those slices will be written against, proven before it has any
 * callers — which is the cheapest moment to get it right.
 */

// ============================================================================
// 1. THE ORIGINS
// ============================================================================

/**
 * Every way an order can enter Greenway.
 *
 * Deliberately a closed set. A new marketplace is a deliberate edit here plus
 * whatever CI then demands, rather than a new string appearing in a database
 * column that three subsystems interpret differently.
 *
 * - `greenway`  — placed on GreenwayMarijuana.com. The only kind that exists today.
 * - `leafly`    — arrived through the Leafly Order Integration API (slices L-5/L-6).
 * - `register`  — rung up at the counter and materialized into `orders` by the POS
 *                 sync. Not an "online order" at all, but it lives in the same
 *                 table, so anything reasoning about that table must account for it.
 */
export const ORDER_ORIGINS = ["greenway", "leafly", "register"] as const;
export type OrderOrigin = (typeof ORDER_ORIGINS)[number];

/** The origin assumed for any order that predates the origin column. */
export const DEFAULT_ORDER_ORIGIN: OrderOrigin = "greenway";

/**
 * Origins that represent an order a customer placed remotely and will come in to
 * collect. These are the ones that belong on the register's pickup queue, that
 * are worth announcing, and that are worth printing.
 *
 * `register` is excluded on purpose: a sale rung at the counter is already in the
 * customer's hand. Announcing it would make the speaker cry wolf, and the shop
 * would learn to ignore it — which costs the announcement that mattered.
 */
export const PICKUP_ORDER_ORIGINS = ["greenway", "leafly"] as const;

/**
 * Origins that reach Greenway through somebody else's marketplace.
 *
 * This is the set that carries the communications restriction proven in slice
 * L-1b: for a marketplace order, the marketplace owns the customer's emails and
 * we must not also send them. Keeping that set defined HERE rather than inside
 * the email code means a future marketplace inherits the rule by being added to
 * one list, instead of by somebody remembering.
 */
export const MARKETPLACE_ORDER_ORIGINS = ["leafly"] as const;

export function isOrderOrigin(value: unknown): value is OrderOrigin {
  return typeof value === "string" && (ORDER_ORIGINS as readonly string[]).includes(value);
}

/**
 * Coerce an unknown (a database column, a JSON body, a legacy row) into an origin.
 *
 * Unknown input becomes `greenway` rather than throwing, because this runs on the
 * order path and an unrecognised origin must never be able to lose an order. The
 * bias is deliberate and it is the SAFE direction: `greenway` is the origin with
 * the FEWEST restrictions attached to it, so a misread never silently suppresses
 * a customer's email or hides an order from the counter. It only ever costs us a
 * different chime.
 *
 * Note the asymmetry with `mayEmailCustomerForOrigin` below, which fails the
 * other way for the same reason: there, permissive is the dangerous direction.
 */
export function toOrderOrigin(value: unknown): OrderOrigin {
  if (typeof value !== "string") return DEFAULT_ORDER_ORIGIN;
  const trimmed = value.trim().toLowerCase();
  return isOrderOrigin(trimmed) ? trimmed : DEFAULT_ORDER_ORIGIN;
}

export function isPickupOrigin(origin: OrderOrigin): boolean {
  return (PICKUP_ORDER_ORIGINS as readonly string[]).includes(origin);
}

export function isMarketplaceOrigin(origin: OrderOrigin): boolean {
  return (MARKETPLACE_ORDER_ORIGINS as readonly string[]).includes(origin);
}

// ============================================================================
// 2. WHAT STAFF SEE
// ============================================================================

/**
 * The short badge on the register tile and the back-office row.
 *
 * Kept to one or two words because it sits next to the customer's name in a
 * narrow column on an iPad, and a label that wraps is a label nobody reads.
 */
export function orderOriginLabel(origin: OrderOrigin): string {
  switch (origin) {
    case "greenway":
      return "Website";
    case "leafly":
      return "Leafly";
    case "register":
      return "Register";
  }
}

/**
 * The line that goes on the printed receipt, under the order number.
 *
 * This is the owner's "a way to distinguish the two" in its most literal form:
 * whoever picks the bag off the shelf reads this. It names the marketplace
 * explicitly, because the practical difference for staff is that a Leafly
 * customer has already been told what is happening by Leafly, and a website
 * customer has been told by us.
 */
export function orderOriginReceiptLine(origin: OrderOrigin): string {
  switch (origin) {
    case "greenway":
      return "ONLINE ORDER — greenwaymarijuana.com";
    case "leafly":
      return "LEAFLY ORDER — placed on Leafly";
    case "register":
      return "REGISTER SALE";
  }
}

// ============================================================================
// 3. WHAT THE SPEAKER DOES
// ============================================================================

/**
 * The built-in chime each origin gets by default.
 *
 * These ids are not invented here. They are the exact set the Raspberry Pi can
 * synthesise on its own, verified in `pi-agent/greenway_announcer.py`
 * (`BUILTIN_SOUND_ORDER`, and the `patterns` table in `generate_tone_wav`):
 *
 *     chime, bell, ding, alert, cash, voice
 *
 * The Pi resolves whatever string the server puts in `announcer_queue.sound`
 * (`resolve_sound`), and decides built-in vs. uploaded by SHAPE — no slash and
 * no dot means built-in (`is_builtin_sound`). So two origins can already have
 * two different sounds without the Pi changing at all. The only thing missing
 * was somewhere to decide.
 *
 * WHY THESE TWO
 * -------------
 * `chime` for the website is what the shop already hears, and changing the
 * familiar sound to make room for a new one would retrain everybody for no
 * reason. `bell` for Leafly is the built-in whose own hint is "Classic shop
 * bell. Cuts through chatter." — it is the most distinguishable from `chime` at
 * a distance, which is the whole point of the owner's request. Both are
 * defaults, not decrees: `resolveOriginSound` lets an explicit per-origin
 * choice from the settings page win.
 */
export const ORIGIN_DEFAULT_SOUND_IDS: Readonly<Record<OrderOrigin, string>> = {
  greenway: "chime",
  leafly: "bell",
  register: "chime",
} as const;

/**
 * Does this origin make a noise at all?
 *
 * A register sale does not. The customer is standing there.
 */
export function shouldAnnounceOrigin(origin: OrderOrigin): boolean {
  return isPickupOrigin(origin);
}

/**
 * Pick the sound for an order, given what the shop has configured.
 *
 * THE INVARIANT: this function can never return an empty string. It mirrors the
 * guarantee `resolveSound()` already makes in announcer-core.ts — a speaker that
 * plays nothing is indistinguishable from a broken speaker at twenty feet, so
 * every path here ends on a real sound id.
 *
 * `configured` is whatever the owner chose for this origin on the settings page
 * (null when he has not chosen). It is trusted only far enough to be non-blank;
 * validating that it names a real built-in or an existing upload is the caller's
 * job, because only the caller has listed the bucket — the same division of
 * labour `resolveSound()` already uses.
 */
export function resolveOriginSound(input: {
  origin: OrderOrigin;
  configured?: string | null | undefined;
}): string {
  const configured = typeof input.configured === "string" ? input.configured.trim() : "";
  if (configured !== "") return configured;
  return ORIGIN_DEFAULT_SOUND_IDS[input.origin];
}

/**
 * What the speaker says out loud when the "voice" sound is selected.
 *
 * Same discipline as `announcementText()` in announcer-core.ts, which this is
 * designed to replace the hardcoded half of: it carries the fact and nothing
 * else. Never the customer's name, never what they bought — that gets said
 * across a sales floor with other customers in it and is not ours to broadcast.
 *
 * The existing function says "New online order." for everything. That sentence
 * is exactly the bug: it is not wrong today, because today there IS only one
 * kind of online order, which is what makes it so easy to leave in place until
 * it becomes wrong silently.
 */
export function originAnnouncementText(input: {
  origin: OrderOrigin;
  orderNumber?: string | null | undefined;
}): string {
  const num =
    typeof input.orderNumber === "string" && input.orderNumber.trim() !== ""
      ? input.orderNumber.trim()
      : "";

  const lead = input.origin === "leafly" ? "New Leafly order" : "New online order";
  return num === "" ? `${lead}.` : `${lead}. Number ${num}.`;
}

// ============================================================================
// 4. WHAT WE ARE ALLOWED TO SEND THE CUSTOMER
// ============================================================================

/**
 * May WE email the customer about this order?
 *
 * Grounded in Leafly's own Order API specification, which states that Leafly is
 * the sole originator of consumer order communications. Slice L-1b proved the
 * rule and encoded it in `src/lib/leafly/order-contract-core.ts`; this is the
 * same rule expressed in the vocabulary the order path actually speaks, so a
 * future marketplace inherits it by joining MARKETPLACE_ORDER_ORIGINS.
 *
 * Note the direction of the failure, and contrast it with `toOrderOrigin` above.
 * There, an unknown value resolves to the LEAST restricted origin, because the
 * cost of guessing wrong is a wrong chime. Here, the cost of guessing wrong is
 * emailing a customer we were contractually forbidden to email, so this asks
 * "is this origin explicitly permitted?" rather than "is it explicitly denied".
 * Add a marketplace and forget to update this, and the answer is silence — the
 * safe failure — instead of a duplicate confirmation.
 */
export function mayEmailCustomerForOrigin(origin: OrderOrigin): boolean {
  return !isMarketplaceOrigin(origin);
}

/**
 * Staff-facing email is always permitted, for every origin.
 *
 * Leafly's restriction is about the CONSUMER relationship. Nothing stops us
 * telling our own team that an order arrived, and the POS providers that already
 * do this (POSaBIT, Cova, Dutchie — see docs/leafly-order-api-v1.md §3.4) all
 * notify staff in exactly this way. Expressed as a function rather than a
 * comment so the asymmetry is visible at every call site.
 */
export function mayEmailStaffForOrigin(
  // The parameter is intentionally unused: taking the origin makes the
  // asymmetry with mayEmailCustomerForOrigin() visible at every call site,
  // and it means a future origin-specific staff rule needs no signature churn.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _origin: OrderOrigin,
): boolean {
  return true;
}

// ============================================================================
// SELF-TESTS
// ============================================================================

/**
 * Embedded self-tests (house rule 5). Registered in
 * scripts/compliance/run-pure-selftests.ts and mirrored in
 * tests/compliance/order-origin.test.ts, so a self-test that nothing invokes can
 * never become dead code wearing a green check.
 */
export function __runOrderOriginTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (label: string, cond: boolean): void => {
    if (cond) {
      passed += 1;
    } else {
      failed += 1;
      console.error(`order-origin FAIL: ${label}`);
    }
  };

  // -- the set itself --------------------------------------------------------
  ok("three origins", ORDER_ORIGINS.length === 3);
  ok("greenway is an origin", isOrderOrigin("greenway"));
  ok("leafly is an origin", isOrderOrigin("leafly"));
  ok("register is an origin", isOrderOrigin("register"));
  ok("weedmaps is NOT an origin yet", !isOrderOrigin("weedmaps"));
  ok("rejects non-strings", !isOrderOrigin(null) && !isOrderOrigin(7) && !isOrderOrigin({}));
  ok("default origin is greenway", DEFAULT_ORDER_ORIGIN === "greenway");

  // -- coercion --------------------------------------------------------------
  ok("coerce exact", toOrderOrigin("leafly") === "leafly");
  ok("coerce trims", toOrderOrigin("  leafly  ") === "leafly");
  ok("coerce lowercases", toOrderOrigin("LEAFLY") === "leafly");
  ok("coerce mixed case", toOrderOrigin("Leafly") === "leafly");
  ok("coerce unknown -> greenway", toOrderOrigin("shopify") === "greenway");
  ok("coerce null -> greenway", toOrderOrigin(null) === "greenway");
  ok("coerce undefined -> greenway", toOrderOrigin(undefined) === "greenway");
  ok("coerce empty -> greenway", toOrderOrigin("") === "greenway");
  ok("coerce number -> greenway", toOrderOrigin(42) === "greenway");

  // -- classification --------------------------------------------------------
  ok("greenway is a pickup origin", isPickupOrigin("greenway"));
  ok("leafly is a pickup origin", isPickupOrigin("leafly"));
  ok("register is NOT a pickup origin", !isPickupOrigin("register"));
  ok("leafly is a marketplace", isMarketplaceOrigin("leafly"));
  ok("greenway is NOT a marketplace", !isMarketplaceOrigin("greenway"));
  ok("register is NOT a marketplace", !isMarketplaceOrigin("register"));

  // -- labels ----------------------------------------------------------------
  ok("greenway label", orderOriginLabel("greenway") === "Website");
  ok("leafly label", orderOriginLabel("leafly") === "Leafly");
  ok("register label", orderOriginLabel("register") === "Register");
  ok(
    "every origin has a non-empty label",
    ORDER_ORIGINS.every((o) => orderOriginLabel(o).trim() !== ""),
  );
  ok(
    "labels are distinct",
    new Set(ORDER_ORIGINS.map((o) => orderOriginLabel(o))).size === ORDER_ORIGINS.length,
  );
  ok("leafly receipt line names Leafly", /Leafly/.test(orderOriginReceiptLine("leafly")));
  ok(
    "greenway receipt line names the website",
    /greenwaymarijuana\.com/.test(orderOriginReceiptLine("greenway")),
  );
  ok(
    "receipt lines are distinct",
    new Set(ORDER_ORIGINS.map((o) => orderOriginReceiptLine(o))).size === ORDER_ORIGINS.length,
  );

  // -- announcing ------------------------------------------------------------
  ok("announce website orders", shouldAnnounceOrigin("greenway"));
  ok("announce leafly orders", shouldAnnounceOrigin("leafly"));
  ok("do NOT announce register sales", !shouldAnnounceOrigin("register"));

  // The owner's actual request: two order types, two chimes.
  ok(
    "website and leafly get DIFFERENT default chimes",
    ORIGIN_DEFAULT_SOUND_IDS.greenway !== ORIGIN_DEFAULT_SOUND_IDS.leafly,
  );
  ok("website keeps the familiar chime", ORIGIN_DEFAULT_SOUND_IDS.greenway === "chime");
  ok("leafly gets the bell", ORIGIN_DEFAULT_SOUND_IDS.leafly === "bell");

  // Every default must be a sound the Pi can actually produce unaided. This list
  // is BUILTIN_SOUND_ORDER from pi-agent/greenway_announcer.py. If someone
  // defaults an origin to a sound the Pi has never heard of, the Pi tries to
  // DOWNLOAD it, 404s, and falls back to chime -- silently undoing the feature.
  const piBuiltIns = ["chime", "bell", "ding", "alert", "cash", "voice"];
  ok(
    "every default sound is a Pi built-in",
    ORDER_ORIGINS.every((o) => piBuiltIns.includes(ORIGIN_DEFAULT_SOUND_IDS[o])),
  );
  // The Pi decides built-in vs custom by SHAPE: no slash, no dot.
  ok(
    "no default sound would be mistaken for a storage path",
    ORDER_ORIGINS.every((o) => {
      const s = ORIGIN_DEFAULT_SOUND_IDS[o];
      return !s.includes("/") && !s.includes(".");
    }),
  );

  // -- sound resolution ------------------------------------------------------
  ok("unconfigured leafly -> bell", resolveOriginSound({ origin: "leafly" }) === "bell");
  ok("unconfigured website -> chime", resolveOriginSound({ origin: "greenway" }) === "chime");
  ok(
    "configured wins",
    resolveOriginSound({ origin: "leafly", configured: "alert" }) === "alert",
  );
  ok(
    "configured custom path wins",
    resolveOriginSound({ origin: "leafly", configured: "custom/leafly.wav" }) ===
      "custom/leafly.wav",
  );
  ok(
    "blank configured falls back",
    resolveOriginSound({ origin: "leafly", configured: "   " }) === "bell",
  );
  ok(
    "null configured falls back",
    resolveOriginSound({ origin: "leafly", configured: null }) === "bell",
  );
  ok(
    "configured is trimmed",
    resolveOriginSound({ origin: "leafly", configured: "  ding  " }) === "ding",
  );
  ok(
    "never resolves to empty, for any origin, configured or not",
    ORDER_ORIGINS.every(
      (o) =>
        resolveOriginSound({ origin: o }).trim() !== "" &&
        resolveOriginSound({ origin: o, configured: null }).trim() !== "" &&
        resolveOriginSound({ origin: o, configured: "" }).trim() !== "",
    ),
  );

  // -- spoken text -----------------------------------------------------------
  ok(
    "leafly spoken line says Leafly",
    originAnnouncementText({ origin: "leafly", orderNumber: "GWY-123" }) ===
      "New Leafly order. Number GWY-123.",
  );
  ok(
    "website spoken line unchanged in spirit",
    originAnnouncementText({ origin: "greenway", orderNumber: "GWY-123" }) ===
      "New online order. Number GWY-123.",
  );
  ok(
    "no number -> no dangling Number",
    originAnnouncementText({ origin: "leafly" }) === "New Leafly order.",
  );
  ok(
    "blank number -> no dangling Number",
    originAnnouncementText({ origin: "greenway", orderNumber: "   " }) === "New online order.",
  );
  ok(
    "number is trimmed",
    originAnnouncementText({ origin: "greenway", orderNumber: " GWY-9 " }) ===
      "New online order. Number GWY-9.",
  );
  ok(
    "spoken text never leaks a customer name",
    !originAnnouncementText({ origin: "leafly", orderNumber: "GWY-1" })
      .toLowerCase()
      .includes("customer"),
  );
  ok(
    "the two spoken lines actually differ",
    originAnnouncementText({ origin: "leafly", orderNumber: "X" }) !==
      originAnnouncementText({ origin: "greenway", orderNumber: "X" }),
  );

  // -- communications --------------------------------------------------------
  ok("we may email our own customers", mayEmailCustomerForOrigin("greenway"));
  ok("we may NOT email Leafly's customers", !mayEmailCustomerForOrigin("leafly"));
  ok("we may email register customers", mayEmailCustomerForOrigin("register"));
  ok(
    "staff email is permitted for every origin",
    ORDER_ORIGINS.every((o) => mayEmailStaffForOrigin(o)),
  );
  // The rule restated structurally: suppression follows marketplace membership,
  // so a new marketplace inherits it without anyone remembering to.
  ok(
    "customer email is suppressed for exactly the marketplaces",
    ORDER_ORIGINS.every((o) => mayEmailCustomerForOrigin(o) === !isMarketplaceOrigin(o)),
  );

  console.log(`order-origin: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
